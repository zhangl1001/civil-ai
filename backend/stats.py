"""
Statistics update engine — all programmatic, zero LLM.

Handles deterministic updates after grading:
  练习统计.json, 能力画像.json, 复习队列.json,
  每日完成/{date}.json, syllabus/{模块}.json, 错题本/{模块}.md

Ability model (v3 — full-cycle):
  Phase-aware proficiency = accuracy_ema × w_acc + speed × w_spd
                          + stability × w_stb + recency × w_rec
  Weights vary by phase (基础期/强化期/冲刺期).

Per-KP tracking:
  - by_difficulty: ★/★★/★★★ accuracy breakdown (no inflated scores)
  - errors: aggregated error types (概念性/理解性/执行性) → dominant
  - plateau: stuck accuracy across N sessions → intervention needed
  - review: spaced repetition history + verification
  - roi: learning efficiency (attempts to mastery)
  - mock_exam: independent exam simulation tracking

New modes: practice, review, mock_exam, diagnostic
"""

import json
import os
import re
import threading
from cli.settings import get_user_dir
from datetime import date as dt_date, timedelta
from typing import Optional


def _get_project_dir() -> str:
    # User data lives in ~/.zhangl-agent/projects/ (survives code updates)
    user_projects = os.path.join(get_user_dir(), "projects")
    if os.path.isdir(user_projects):
        dirs = [d for d in os.listdir(user_projects) if os.path.isdir(os.path.join(user_projects, d)) and not d.startswith('.')]
        if dirs: return os.path.join(user_projects, dirs[0])
    # Fallback: code directory (legacy)
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    legacy = os.path.join(project_root, "projects", "公考练习")
    if os.path.isdir(legacy):
        return legacy
    # Create in user directory
    default = os.path.join(user_projects, "公考练习")
    os.makedirs(default, exist_ok=True)
    return default


PROJECT_DIR = _get_project_dir()


def _read_json(path: str) -> dict:
    if not os.path.isfile(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# Per-path write lock to prevent lost updates when concurrent requests
# write to the same file (e.g., 练习统计.json from parallel expert results)
_file_locks: dict[str, threading.Lock] = {}


def _get_file_lock(path: str) -> threading.Lock:
    """Get or create a threading.Lock for a given file path."""
    if path not in _file_locks:
        _file_locks[path] = threading.Lock()
    return _file_locks[path]


def _write_json(path: str, data: dict):
    """Atomic write with per-path lock to prevent concurrent lost updates."""
    lock = _get_file_lock(path)
    with lock:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, path)  # atomic on POSIX


def _today() -> str:
    return dt_date.today().isoformat()


def _tomorrow() -> str:
    return (dt_date.today() + timedelta(days=1)).isoformat()


def _days_between(d1: str, d2: str) -> int:
    try:
        return (dt_date.fromisoformat(d1) - dt_date.fromisoformat(d2)).days
    except (ValueError, TypeError):
        return 0


def _letter_grade(score: int) -> str:
    if score >= 95: return "S"
    if score >= 85: return "A"
    if score >= 70: return "B"
    if score >= 60: return "C"
    return "D"


def _is_essay_module(module: str) -> bool:
    return module == "申论"


# ── Time standards (from 备考计划.json) ──────────────────────────

def _load_time_standards() -> dict[str, int]:
    """Returns {module: seconds_per_q} from study plan."""
    path = os.path.join(PROJECT_DIR, "备考计划.json")
    plan = _read_json(path)
    standards = {}
    for mod, ts in plan.get("time_standards", {}).items():
        if isinstance(ts, dict):
            standards[mod] = ts.get("seconds_per_q", 60)
    return standards


# ── Ability model helpers ─────────────────────────────────────────

def _get_kp_session_history(module: str, kp_name: str) -> list[dict]:
    """Get practice records for a specific knowledge point, sorted by date."""
    path = os.path.join(PROJECT_DIR, "练习统计.json")
    stats = _read_json(path)
    records = stats.get("records", [])
    return sorted(
        [r for r in records if r.get("module") == module and r.get("knowledge_point") == kp_name],
        key=lambda r: r.get("date", "")
    )


def _compute_ema(records: list[dict], old_ema: Optional[float] = None) -> float:
    """
    Exponential moving average of per-session accuracy (α=0.3).
    Seeds from the first record's accuracy to avoid cold-start penalty
    where 100% accuracy in first session would produce EMA=0.3.
    """
    if not records:
        return old_ema if old_ema is not None else 0.0
    alpha = 0.3
    ema = old_ema if old_ema is not None else records[0].get("accuracy", 0)
    start = 0 if old_ema is not None else 1
    for r in records[start:]:
        ema = alpha * r.get("accuracy", 0) + (1 - alpha) * ema
    return round(ema, 4)


def _compute_speed_factor(avg_time_seconds: float, module: str) -> float:
    """How fast vs time standard. 1.0 = on time, <1.0 = too slow."""
    if avg_time_seconds <= 0:
        return 1.0  # no timing data → assume on time, don't penalize
    standards = _load_time_standards()
    standard = standards.get(module, 60)
    if standard <= 0:
        return 1.0
    ratio = standard / avg_time_seconds
    return round(min(1.0, ratio), 3)


def _compute_recency_factor(last_studied: str) -> float:
    """Decay from 1.0→0.3 over 60 days since last practice."""
    if not last_studied:
        return 0.3
    days = _days_between(_today(), last_studied)
    if days <= 0:
        return 1.0
    if days >= 60:
        return 0.3
    return round(1.0 - 0.7 * (days / 60), 3)


def _compute_stability(records: list[dict]) -> float:
    """
    1.0 - coefficient of variation of session accuracies.
    High stability = consistent performance. Low = volatile.
    Returns 0.5 if insufficient data (< 3 sessions).
    """
    accs = [r.get("accuracy", 0) for r in records if r.get("total", 0) >= 3]
    if len(accs) < 2:
        return 0.5  # insufficient data → neutral
    mean = sum(accs) / len(accs)
    if mean == 0:
        return 0.5
    variance = sum((a - mean) ** 2 for a in accs) / len(accs)
    std = variance ** 0.5
    cv = std / mean  # coefficient of variation
    stability = 1.0 - min(cv, 1.0)
    return round(max(0.3, stability), 3)


def _compute_confidence(attempts: int) -> str:
    if attempts < 5: return "不足"
    if attempts < 15: return "一般"
    if attempts < 30: return "充分"
    return "非常充分"


def _compute_trend_v2(records: list[dict]) -> tuple[str, float]:
    """
    Compare EMA of last 3 sessions vs EMA of sessions before that.
    Returns (trend_label, delta).
    """
    if len(records) < 2:
        return ("new", 0.0)

    # Split: most recent ~40% of sessions vs earlier ~60%
    split = max(1, len(records) * 2 // 5)
    recent = records[-split:]
    earlier = records[:-split]

    if not earlier:
        return ("new", 0.0)

    recent_avg = sum(r.get("accuracy", 0) for r in recent) / len(recent)
    earlier_avg = sum(r.get("accuracy", 0) for r in earlier) / len(earlier)
    delta = round(recent_avg - earlier_avg, 4)

    if delta > 0.05: return ("上升", delta)
    if delta < -0.05: return ("下降", delta)
    return ("稳定", delta)


# ── Phase-aware proficiency model ─────────────────────────────────

# Weights per phase: (accuracy, speed, consistency/stability, recency)
PHASE_WEIGHTS = {
    "基础期": (0.70, 0.00, 0.20, 0.10),   # accuracy only, speed ignored
    "强化期": (0.45, 0.25, 0.20, 0.10),   # speed starts to matter
    "冲刺期": (0.35, 0.35, 0.20, 0.10),   # speed equally important
}

# Status thresholds per phase: (mastered_prof, mastered_attempts, relearn_prof, relearn_attempts, weak_prof, weak_attempts)
PHASE_THRESHOLDS = {
    "基础期": (0.70, 15, 0.50, 8, 0.60, 5),    # lenient: 70% proficiency = mastered
    "强化期": (0.75, 20, 0.55, 10, 0.65, 8),    # stricter: need 75% + 20 attempts
    "冲刺期": (0.80, 25, 0.60, 12, 0.70, 10),   # strictest: 80% + 25 attempts
}

# Essay thresholds: same proficiency, lower attempts (申论练题量远小于行测)
ESSAY_THRESHOLDS = {
    "基础期": (0.70, 3, 0.50, 2, 0.60, 2),
    "强化期": (0.75, 4, 0.55, 3, 0.65, 3),
    "冲刺期": (0.80, 5, 0.60, 4, 0.70, 3),
}


def _get_current_phase() -> str:
    """Read current phase from study plan."""
    path = os.path.join(PROJECT_DIR, "备考计划.json")
    plan = _read_json(path)
    return plan.get("phase", "基础期")


def _compute_proficiency(accuracy_ema: float, speed_factor: float,
                         recency_factor: float, stability: float,
                         phase: str = "基础期") -> float:
    """Phase-aware composite proficiency score 0-1."""
    w_acc, w_spd, w_stb, w_rec = PHASE_WEIGHTS.get(phase, PHASE_WEIGHTS["基础期"])
    raw = accuracy_ema * w_acc + speed_factor * w_spd + stability * w_stb + recency_factor * w_rec
    return round(min(1.0, raw), 4)


def _detect_plateau(records: list[dict], threshold: int = 4) -> dict:
    """
    Plateau: last N sessions all within ±8% accuracy range.
    Returning is_plateau and the stuck accuracy level.
    """
    if len(records) < threshold:
        return {"is_plateau": False, "sessions_at_level": 0, "avg_accuracy": 0.0}
    recent = records[-threshold:]
    accs = [r.get("accuracy", 0) for r in recent if r.get("total", 0) >= 3]
    if len(accs) < threshold:
        return {"is_plateau": False, "sessions_at_level": 0, "avg_accuracy": 0.0}
    avg = sum(accs) / len(accs)
    # Check if all within ±8% of average
    if all(abs(a - avg) <= 0.08 for a in accs):
        return {"is_plateau": True, "sessions_at_level": len(accs), "avg_accuracy": round(avg, 3)}
    return {"is_plateau": False, "sessions_at_level": 0, "avg_accuracy": round(avg, 3)}


def _compute_roi(attempts: int, proficiency: float, is_mastered: bool) -> dict:
    """
    ROI score: how efficiently the student learned this KP.
    High ROI = few attempts to reach high proficiency.
    Learning rate = proficiency/attempts (proficiency gained per attempt).
    """
    if attempts < 3:
        return {"score": 0.0, "attempts_to_master": None, "learning_rate": 0.0}
    learning_rate = round(proficiency / attempts, 4) if attempts > 0 else 0.0
    # ROI: mastery efficiency weighted by proficiency
    roi = round(min(1.0, proficiency * (1.0 if is_mastered else 0.5) * min(1.0, 30 / max(attempts, 1))), 3)
    attempts_to_master = attempts if is_mastered else None
    return {"score": roi, "attempts_to_master": attempts_to_master, "learning_rate": learning_rate}


def _determine_status(proficiency: float, attempts: int, recency_days: int,
                      is_essay: bool = False, phase: str = "基础期") -> tuple[str, bool]:
    """Phase-aware status determination."""
    if attempts < 3:
        return ("学习中", False)

    thresholds = ESSAY_THRESHOLDS if is_essay else PHASE_THRESHOLDS
    m_prof, m_att, r_prof, r_att, w_prof, w_att = thresholds.get(phase, thresholds["基础期"])

    is_mastered = proficiency >= m_prof and attempts >= m_att and recency_days <= 30
    need_relearn = proficiency < r_prof and attempts >= r_att

    if is_mastered:
        return ("已掌握", True)
    if need_relearn:
        return ("需重学", False)
    if proficiency < w_prof and attempts >= w_att:
        return ("薄弱", False)
    return ("学习中", False)


# ── Practice Stats (练习统计.json) ──────────────────────────────

def update_practice_stats(module: str, knowledge_point: str, total: int, correct: int,
                          time_seconds: int, date: str, batch_label: str = "首次") -> dict:
    path = os.path.join(PROJECT_DIR, "练习统计.json")
    stats = _read_json(path)
    if not stats:
        stats = {"records_summary": {"total_sessions": 0, "total_questions": 0,
                                      "total_correct": 0, "overall_accuracy": 0,
                                      "by_module": {}}, "records": []}

    records = stats.get("records", [])
    new_id = max((r.get("id", 0) for r in records), default=0) + 1
    avg_time = round(time_seconds / total, 1) if total > 0 else 0

    record = {
        "id": new_id,
        "date": date,
        "module": module,
        "knowledge_point": knowledge_point,
        "batch": batch_label,
        "total": total,
        "correct": correct,
        "accuracy": round(correct / total, 3) if total > 0 else 0,
        "time_seconds": time_seconds,
        "avg_time_seconds": avg_time,
    }
    records.append(record)

    total_q = sum(r["total"] for r in records)
    total_c = sum(r["correct"] for r in records)
    overall_acc = round(total_c / total_q, 3) if total_q > 0 else 0

    by_module = {}
    for r in records:
        m = r["module"]
        if m not in by_module:
            by_module[m] = {"sessions": 0, "questions": 0, "correct": 0, "accuracy": 0}
        by_module[m]["sessions"] += 1
        by_module[m]["questions"] += r["total"]
        by_module[m]["correct"] += r["correct"]
    for m in by_module:
        by_module[m]["accuracy"] = round(by_module[m]["correct"] / by_module[m]["questions"], 3)

    stats["records_summary"] = {
        "total_sessions": len(set((r["date"], r["module"]) for r in records)),
        "total_questions": total_q,
        "total_correct": total_c,
        "overall_accuracy": overall_acc,
        "by_module": by_module,
    }
    stats["records"] = records
    _write_json(path, stats)
    return stats["records_summary"]


# ── Ability Profile (能力画像.json) ─────────────────────────────

DEFAULT_KP = {
    "status": "学习中", "last_studied": "",
    # 综合指标
    "accuracy": 0, "proficiency": 0,
    "accuracy_ema": 0, "speed_factor": 1.0,
    "recency_days": 0, "stability": 0.5,
    "attempts": 0, "correct": 0,
    "avg_time_seconds": 0, "trend": "new", "trend_delta": 0,
    "confidence": "不足",
    # v3 新增
    "by_difficulty": {"★": {"attempts": 0, "correct": 0},
                       "★★": {"attempts": 0, "correct": 0},
                       "★★★": {"attempts": 0, "correct": 0}},
    "errors": {"概念性错误": 0, "理解性错误": 0, "执行性错误": 0, "dominant": ""},
    "plateau": {"is_plateau": False, "sessions_at_level": 0, "avg_accuracy": 0.0},
    "review": {"last_date": None, "last_accuracy": None, "total": 0, "accuracies": []},
    "roi": {"score": 0.0, "attempts_to_master": None, "learning_rate": 0.0},
}


def update_ability_profile(module: str, knowledge_points: list[str],
                           total_per_kp: dict[str, int],
                           correct_per_kp: dict[str, int],
                           date: str,
                           avg_time_per_kp: dict[str, float] = None,
                           errors_per_kp: dict[str, dict] = None,
                           difficulty_per_kp: dict[str, dict] = None,
                           mode: str = "practice") -> dict:
    """
    Update ability profile with full-cycle tracking.

    Args:
        mode: "practice" | "review" | "mock_exam" | "diagnostic"
        difficulty_per_kp: {kp: {"★": {"total": N, "correct": N}, ...}}
        errors_per_kp: {kp: {"概念性": N, "理解性": N, "执行性": N}}
    """
    path = os.path.join(PROJECT_DIR, "能力画像.json")
    profile = _read_json(path)
    if not profile:
        profile = {"modules": {}, "mock_exam_history": [], "diagnostic_complete": False}

    modules = profile.setdefault("modules", {})
    profile.setdefault("mock_exam_history", [])
    profile.setdefault("diagnostic_complete", False)
    mod = modules.setdefault(module, {})

    # Normalize KP names: if exact match fails, try suffix match
    # e.g. "解释评价" → "逻辑判断-解释评价" to avoid split data
    def _resolve_kp(name: str) -> tuple[str, dict | None]:
        if name in mod:
            return name, mod[name]
        for existing in mod:
            if existing.endswith(f"-{name}") or name.endswith(f"-{existing}"):
                return existing, mod[existing]
        return name, None

    updated_kps = {}
    for kp_name in knowledge_points:
        real_name, existing_kp = _resolve_kp(kp_name)
        kp = existing_kp if existing_kp is not None else dict(DEFAULT_KP)
        kp_name = real_name

        n_total = total_per_kp.get(kp_name, 0)
        n_correct = correct_per_kp.get(kp_name, 0)
        avg_time = (avg_time_per_kp or {}).get(kp_name, kp.get("avg_time_seconds", 0))

        # Update aggregate stats
        new_attempts = kp.get("attempts", 0) + n_total
        new_correct = kp.get("correct", 0) + n_correct
        new_avg_time = round(
            (kp.get("avg_time_seconds", 0) * kp.get("attempts", 0) + avg_time * n_total) / new_attempts, 1
        ) if new_attempts > 0 else 0

        # Get session history (after practice stats is already updated)
        history = _get_kp_session_history(module, kp_name)

        # Compute EMA — use old EMA as starting point for continuity
        old_ema = kp.get("accuracy_ema")
        accuracy_ema = _compute_ema(history, old_ema)

        # Multi-dimensional scores
        speed_factor = _compute_speed_factor(new_avg_time, module)
        recency_factor = _compute_recency_factor(date)
        recency_days = _days_between(_today(), date)
        stability = _compute_stability(history)
        phase = _get_current_phase()
        proficiency = _compute_proficiency(accuracy_ema, speed_factor, recency_factor, stability, phase)
        confidence = _compute_confidence(new_attempts)
        trend_label, trend_delta = _compute_trend_v2(history)

        # Status determination
        status, is_mastered = _determine_status(
            proficiency, new_attempts, recency_days, _is_essay_module(module), phase
        )

        # Raw accuracy (simple truth, always available)
        raw_accuracy = round(new_correct / new_attempts, 3) if new_attempts > 0 else 0

        # v3: difficulty breakdown
        by_diff = kp.get("by_difficulty", dict(DEFAULT_KP["by_difficulty"]))
        if difficulty_per_kp and kp_name in difficulty_per_kp:
            for star, d in (difficulty_per_kp.get(kp_name) or {}).items():
                if star in by_diff:
                    by_diff[star]["attempts"] += d.get("total", 0)
                    by_diff[star]["correct"] += d.get("correct", 0)

        # v3: error aggregation
        err = kp.get("errors", dict(DEFAULT_KP["errors"]))
        if errors_per_kp and kp_name in errors_per_kp:
            for etype in ["概念性错误", "理解性错误", "执行性错误"]:
                err[etype] = err.get(etype, 0) + (errors_per_kp.get(kp_name) or {}).get(etype, 0)
            # Determine dominant error type
            max_type = max(["概念性错误", "理解性错误", "执行性错误"], key=lambda t: err.get(t, 0))
            err["dominant"] = max_type if err.get(max_type, 0) > 0 else ""

        # v3: plateau detection
        plateau = _detect_plateau(history)

        # v3: ROI
        roi = _compute_roi(new_attempts, proficiency, is_mastered)

        # v3: review tracking (only updated in review/mock_exam mode)
        rv = kp.get("review", dict(DEFAULT_KP["review"]))
        if mode in ("review", "mock_exam"):
            rv["last_date"] = date
            rv["last_accuracy"] = raw_accuracy
            rv["total"] += 1
            accs = list(rv.get("accuracies", []))
            accs.append(raw_accuracy)
            rv["accuracies"] = accs[-10:]  # keep last 10

        kp.update({
            "status": status,
            "last_studied": date,
            "accuracy": raw_accuracy,
            "proficiency": proficiency,
            "accuracy_ema": accuracy_ema,
            "speed_factor": speed_factor,
            "recency_days": recency_days,
            "stability": stability,
            "attempts": new_attempts,
            "correct": new_correct,
            "avg_time_seconds": new_avg_time,
            "trend": trend_label,
            "trend_delta": trend_delta,
            "confidence": confidence,
            "by_difficulty": by_diff,
            "errors": err,
            "plateau": plateau,
            "roi": roi,
            "review": rv,
        })
        mod[kp_name] = kp
        updated_kps[kp_name] = {
            "attempts": new_attempts, "correct": new_correct,
            "accuracy": raw_accuracy, "proficiency": proficiency,
            "status": status, "is_mastered": is_mastered,
            "confidence": confidence, "trend": trend_label,
            "errors_dominant": err.get("dominant", ""),
            "plateau": plateau["is_plateau"],
            "roi_score": roi["score"],
        }

    modules[module] = mod
    profile["modules"] = modules
    _write_json(path, profile)
    return updated_kps


# ── Review Queue (复习队列.json) ─────────────────────────────────

def update_review_queue(module: str, knowledge_point: str, accuracy: float,
                        is_mastered: bool) -> Optional[dict]:
    """Add mastered KPs to queue, or update review intervals."""
    path = os.path.join(PROJECT_DIR, "复习队列.json")
    queue_data = _read_json(path)
    if not queue_data:
        queue_data = {"queue": []}

    queue = queue_data.get("queue", [])

    existing = None
    for entry in queue:
        if entry["module"] == module and entry["knowledge_point"] == knowledge_point:
            existing = entry
            break

    if existing:
        if accuracy >= 0.80:
            interval_map = {1: 3, 3: 7, 7: 15, 15: 30, 30: 60}
            new_interval = interval_map.get(existing["interval_days"], 61)
            if new_interval >= 60:
                queue.remove(existing)
                result = {"action": "removed", "reason": "fully_mastered"}
            else:
                existing["interval_days"] = new_interval
                existing["next_review"] = (dt_date.today() + timedelta(days=new_interval)).isoformat()
                existing["review_count"] = existing.get("review_count", 0) + 1
                result = {"action": "interval_extended", "new_interval": new_interval}
        else:
            old_interval = existing["interval_days"]
            new_interval = max(1, old_interval // 2)
            existing["interval_days"] = new_interval
            existing["next_review"] = (dt_date.today() + timedelta(days=new_interval)).isoformat()
            existing["review_count"] = existing.get("review_count", 0) + 1
            existing["_consecutive_fails"] = existing.get("_consecutive_fails", 0) + 1
            if existing["_consecutive_fails"] >= 2:
                queue.remove(existing)
                result = {"action": "removed", "reason": "consecutive_fails",
                          "note": "syllabus should be reset to 未学"}
            else:
                result = {"action": "interval_halved", "new_interval": new_interval}
    elif is_mastered:
        entry = {
            "module": module,
            "knowledge_point": knowledge_point,
            "interval_days": 1,
            "next_review": _tomorrow(),
            "review_count": 0,
        }
        queue.append(entry)
        result = {"action": "added", "interval": 1}
    else:
        result = None

    for e in queue:
        e.pop("_consecutive_fails", None)

    queue_data["queue"] = queue
    _write_json(path, queue_data)
    return result


# ── Daily Completion (每日完成/{date}.json) ──────────────────────

def update_daily_completion(date: str, module_results: dict,
                            lecture_completed: bool = True,
                            extra_practice: bool = False,
                            time_seconds: int = 0,
                            time_suggested_seconds: int = 0,
                            comment: str = "") -> dict:
    path = os.path.join(PROJECT_DIR, "每日完成", f"{date}.json")
    existing = _read_json(path)

    all_modules = existing.get("modules", {})
    # Aggregate instead of overwrite — same-day multi-session
    for mod_name, mr in module_results.items():
        if mod_name in all_modules:
            prev = all_modules[mod_name]
            prev["total"] = prev.get("total", 0) + mr.get("total", 0)
            prev["correct"] = prev.get("correct", 0) + mr.get("correct", 0)
        else:
            all_modules[mod_name] = mr

    total_q = sum(m["total"] for m in all_modules.values())
    total_c = sum(m["correct"] for m in all_modules.values())
    overall_acc = round(total_c / total_q, 3) if total_q > 0 else 0

    accuracy_score = round(overall_acc * 50)

    completion_score = 0
    if lecture_completed:
        completion_score += 8
    completed_modules = len([m for m in all_modules.values() if m["total"] > 0])
    completion_score += min(18, completed_modules * 6)
    if extra_practice:
        completion_score += 4

    if time_suggested_seconds > 0 and time_seconds > 0:
        ratio = time_seconds / time_suggested_seconds
        if ratio <= 1.0:
            time_score = 20
        elif ratio <= 1.5:
            time_score = 10
        else:
            time_score = 0
    else:
        time_score = 20

    total_score = min(100, accuracy_score + completion_score + time_score)
    grade = _letter_grade(total_score)

    daily = {
        "overall": {
            "score": total_score,
            "grade": grade,
            "accuracy": overall_acc,
            "total_questions": total_q,
            "total_correct": total_c,
            "accuracy_score": accuracy_score,
            "completion_score": completion_score,
            "time_score": time_score,
            "comment": comment or _default_comment(grade, overall_acc),
        },
        "modules": all_modules,
    }

    if existing:
        daily = {**existing, **daily}

    _write_json(path, daily)
    return daily


def _default_comment(grade: str, accuracy: float) -> str:
    if grade == "S": return "表现优异，继续保持！"
    if grade == "A": return "完成不错，还有提升空间。"
    if grade == "B": return "基础还可以，需要针对薄弱点加强。"
    if grade == "C": return "需要更多练习，建议回顾讲义内容。"
    return "基础薄弱，建议重新学习知识点再做题。"


# ── Syllabus Update ──────────────────────────────────────────────

def update_syllabus(module: str, knowledge_point: str, new_status: str) -> bool:
    path = os.path.join(PROJECT_DIR, "syllabus", f"{module}.json")
    syllabus = _read_json(path)
    if not syllabus:
        return False
    items = syllabus.get(module, [])
    for item in items:
        if item.get("name") == knowledge_point:
            item["status"] = new_status
            _write_json(path, syllabus)
            return True
    return False


# ── Wrong Book Formatting ────────────────────────────────────────

def _extract_question_from_practice(file_path: str, q_num) -> str:
    """
    Extract question text from a practice file using DEFINED structure:
      - Questions are separated by: \\n---\\n
      - Each question starts with: **N.**
      - Answer divs use: <div class="answer-block">...</div>
    These are NOT fuzzy patterns — they are the fixed format written by write_questions.
    """
    full_path = os.path.join(PROJECT_DIR, file_path)
    if not os.path.isfile(full_path):
        return ""
    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return ""

    q_num = int(q_num) if q_num is not None else 0
    if q_num <= 0:
        return ""

    # Split by DEFINED separator: \n---\n
    blocks = re.split(r'\n---\n', content)
    # DEFINED question marker: **N.** at start of block
    marker = f"**{q_num}.**"

    for block in blocks:
        block = block.strip()
        if block.startswith(marker):
            # Remove answer-block and grading-block divs (DEFINED wrappers)
            block = re.sub(
                r'<div\s+class="(?:answer-block|grading-block)[^"]*".*?</div>\s*',
                '', block, flags=re.DOTALL
            )
            return block.strip()

    return ""


def append_wrong_book(module: str, date: str, wrong_items: list[dict]) -> str:
    """
    Write wrongbook entries using a FIXED structure.
    Every field starts with a defined **marker：** — no fuzzy parsing needed.

    Structure:
      ### Q{q} | {kp} | {date}

      **原题：**
      {question_text_with_options}
      @see {file_path} Q{q}

      **你的答案：** {user_answer}

      **正确答案：** {correct_answer}

      **错因：**
      {error_analysis}

      **正解：**
      {correct_approach}

      **技巧：**
      {tips}
    """
    if _is_essay_module(module):
        return ""
    path = os.path.join(PROJECT_DIR, "错题本", f"{module}.md")
    os.makedirs(os.path.dirname(path), exist_ok=True)

    lines = []
    for item in wrong_items:
        q = item.get("q", "?")
        kp = item.get("knowledge_point", "")
        fp = item.get("file_path", f"练习/{module}/{date}.md")
        question_text = _extract_question_from_practice(fp, q)

        # Header
        lines.append(f"### Q{q} | {kp} | {date}")
        lines.append("")

        # 原题 — either full text or @see-only fallback
        lines.append("**原题：**")
        if question_text:
            lines.append(question_text)
        lines.append(f"@see {fp} Q{q}")
        lines.append("")

        # 你的答案
        lines.append(f"**你的答案：** {item.get('user_answer', '?')}")

        # 正确答案
        lines.append(f"**正确答案：** {item.get('correct_answer', '?')}")

        # 错因 (may be multi-line)
        error_type = item.get('error_type', '')
        error_analysis = item.get('error_analysis', '')
        reason = f"{error_type} — {error_analysis}" if error_type and error_analysis else (error_type or error_analysis or '')
        lines.append("**错因：**")
        if reason:
            lines.append(reason)

        # 正解 (may be multi-line)
        ca = item.get('correct_approach', '')
        if ca:
            lines.append("**正解：**")
            lines.append(ca)

        # 技巧 (may be multi-line)
        tips = item.get('tips', '')
        if tips:
            lines.append("**技巧：**")
            lines.append(tips)

        lines.append("")

    content = "\n".join(lines)
    with open(path, "a", encoding="utf-8") as f:
        f.write(content)

    return f"Appended {len(wrong_items)} wrong questions to 错题本/{module}.md"


# ── Master Orchestrator ──────────────────────────────────────────

def process_grading_result(data: dict) -> dict:
    mode = data.get("mode", "practice")
    module = data["module"]
    date = data["date"]
    knowledge_points = data.get("knowledge_points", [])
    results = data.get("results", [])
    total = data["total"]
    correct = data["correct"]
    time_seconds = data.get("time_seconds", 0)
    time_suggested = data.get("time_suggested_seconds", 0)
    lecture_completed = data.get("lecture_completed", True)
    extra_practice = data.get("extra_practice", False)
    batch_label = data.get("batch_label", "首次")
    comment = data.get("comment", "")

    summary_parts = []

    # 1. Practice stats
    stats_summary = update_practice_stats(
        module, ", ".join(knowledge_points), total, correct,
        time_seconds, date, batch_label
    )
    summary_parts.append(
        f"练习统计: +{total}题, 正确{correct}/{total} ({stats_summary.get('overall_accuracy', 0):.1%})"
    )

    # 2. Ability profile
    total_per_kp = {}
    correct_per_kp = {}
    # Deduplicate KPs to avoid double-counting when AI passes duplicates
    kp_list = list(dict.fromkeys(knowledge_points)) if knowledge_points else ["__default__"]

    if len(kp_list) == 1:
        total_per_kp[kp_list[0]] = total
        correct_per_kp[kp_list[0]] = correct
    else:
        base = total // len(kp_list)
        remainder = total % len(kp_list)
        for i, kp in enumerate(kp_list):
            total_per_kp[kp] = base + (1 if i < remainder else 0)
        correct_base = correct // len(kp_list)
        correct_rem = correct % len(kp_list)
        for i, kp in enumerate(kp_list):
            correct_per_kp[kp] = correct_base + (1 if i < correct_rem else 0)

    avg_time = round(time_seconds / total, 1) if total > 0 else 0
    avg_time_per_kp = {kp: avg_time for kp in kp_list}

    # v3: Extract difficulty breakdown and error counts from results
    difficulty_per_kp = {}
    errors_per_kp = {}
    for r in results:
        kp = r.get("knowledge_point", kp_list[0] if kp_list else "")
        diff = r.get("difficulty", "★★")
        if kp not in difficulty_per_kp:
            difficulty_per_kp[kp] = {}
        if diff not in difficulty_per_kp[kp]:
            difficulty_per_kp[kp][diff] = {"total": 0, "correct": 0}
        difficulty_per_kp[kp][diff]["total"] += 1
        if r.get("correct"):
            difficulty_per_kp[kp][diff]["correct"] += 1
        # Errors
        if not r.get("correct") and r.get("error_type"):
            etype = r["error_type"]
            if kp not in errors_per_kp:
                errors_per_kp[kp] = {}
            errors_per_kp[kp][etype] = errors_per_kp[kp].get(etype, 0) + 1

    kp_results = update_ability_profile(module, kp_list,
                                        total_per_kp, correct_per_kp,
                                        date, avg_time_per_kp,
                                        errors_per_kp, difficulty_per_kp,
                                        mode)
    for kp_name, kpr in kp_results.items():
        extra = []
        if kpr.get("errors_dominant"):
            extra.append(f"主导错因={kpr['errors_dominant']}")
        if kpr.get("plateau"):
            extra.append("⚠️高原期")
        if kpr.get("roi_score", 0) > 0:
            extra.append(f"ROI={kpr['roi_score']:.2f}")
        extra_str = " " + ", ".join(extra) if extra else ""
        summary_parts.append(
            f"能力画像/{kp_name}: 能力分{kpr['proficiency']:.1%} (原始{kpr['accuracy']:.1%}) "
            f"置信度={kpr['confidence']} 趋势={kpr['trend']} 状态={kpr['status']}{extra_str}"
        )

    # 3. Review queue
    for kp_name, kpr in kp_results.items():
        if kpr.get("is_mastered"):
            rq_result = update_review_queue(module, kp_name, kpr["accuracy"], True)
            if rq_result:
                summary_parts.append(f"复习队列/{kp_name}: {rq_result['action']}")

    # 4. Daily completion
    module_acc = round(correct / total, 3) if total > 0 else 0
    daily = update_daily_completion(
        date,
        {module: {"accuracy": module_acc, "correct": correct, "total": total}},
        lecture_completed, extra_practice, time_seconds, time_suggested, comment
    )
    ov = daily["overall"]
    summary_parts.append(
        f"每日评分: {ov['score']}分/{ov['grade']}级 "
        f"(正确率{ov['accuracy_score']}+完成度{ov['completion_score']}+限时{ov['time_score']})"
    )

    # 4.5 Mock exam history (独立追踪)
    if mode == "mock_exam":
        path = os.path.join(PROJECT_DIR, "能力画像.json")
        profile = _read_json(path)
        mock_history = profile.get("mock_exam_history", [])
        mock_history.append({
            "date": date,
            "module": module,
            "total": total,
            "correct": correct,
            "accuracy": round(correct / total, 3) if total > 0 else 0,
            "time_seconds": time_seconds,
        })
        profile["mock_exam_history"] = mock_history
        _write_json(path, profile)
        summary_parts.append(f"模考记录已保存 (共{len(mock_history)}次)")

    # 5. Wrong book
    wrong_items = [r for r in results if not r.get("correct")]
    if wrong_items and not _is_essay_module(module):
        for item in wrong_items:
            if "knowledge_point" not in item:
                item["knowledge_point"] = knowledge_points[0] if knowledge_points else ""
            if "file_path" not in item:
                item["file_path"] = f"练习/{module}/{date}.md"
        wb_result = append_wrong_book(module, date, wrong_items)
        summary_parts.append(wb_result)

    # 6. Syllabus
    for kp_name, kpr in kp_results.items():
        if kpr["status"] == "已掌握":
            update_syllabus(module, kp_name, "已学")
            summary_parts.append(f"syllabus/{module}/{kp_name} → 已学")

    return {
        "ok": True,
        "summary": "\n".join(summary_parts),
        "daily_score": daily["overall"],
    }


def handle_update_stats(args_json: str) -> str:
    try:
        data = json.loads(args_json)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON — {e}"

    required = ["module", "date", "total", "correct"]
    missing = [k for k in required if k not in data]
    if missing:
        return f"Error: missing required fields: {', '.join(missing)}"

    try:
        result = process_grading_result(data)
        return result["summary"]
    except Exception as e:
        import traceback
        return f"Error updating stats: {e}\n{traceback.format_exc()}"
