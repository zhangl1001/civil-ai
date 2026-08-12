import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import HomeView from '../views/HomeView.vue';
import { requireCandidateCycle } from '@/features/onboarding/candidateRouteGuard';
import { PageHeaderIcon } from '@/components/layout/PageHeaderCodes';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: HomeView,
    meta: { level: 1, tabRoot: true, title: '首页', headerIcon: PageHeaderIcon.Home, onboardingEntry: true }
  },
  {
    path: '/practice',
    redirect: '/vue/practice'
  },
  {
    path: '/exam',
    redirect: '/vue/exam'
  },
  {
    path: '/wrongbook',
    redirect: '/vue/wrongbook'
  },
  {
    path: '/profile',
    redirect: '/vue/profile'
  },
  {
    path: '/essay',
    redirect: { path: '/vue/practice', query: { subject: 'essay', mode: 'tutor' } }
  },
  {
    path: '/calendar',
    redirect: '/vue/calendar'
  },
  {
    path: '/plan',
    redirect: '/vue/plan'
  },
  {
    path: '/practice-card',
    redirect: '/vue/practice/session'
  },
  {
    path: '/digest',
    redirect: '/vue/digest'
  },
  {
    path: '/monthly-digest',
    redirect: '/vue/monthly-digest'
  },
  {
    path: '/interview',
    redirect: '/vue/interview'
  },
  {
    path: '/knowledge-graph',
    redirect: '/vue/knowledge-graph'
  },
  {
    path: '/quality-dashboard',
    redirect: '/vue/quality-dashboard'
  },
  {
    path: '/sprint',
    redirect: '/vue/sprint'
  },
  {
    path: '/error-report',
    redirect: '/vue/error-report'
  },
  {
    path: '/study',
    redirect: '/vue/study'
  },
  {
    path: '/vue',
    name: 'VueHome',
    component: HomeView,
    meta: { level: 1, tabRoot: true, title: '首页', headerIcon: PageHeaderIcon.Home, onboardingEntry: true }
  },
  {
    path: '/vue/diagnosis',
    name: 'VueInitialDiagnosis',
    component: () => import('../features/onboarding/InitialDiagnosisView.vue'),
    meta: { level: 2, title: '初始诊断', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/practice',
    name: 'VuePracticeCenter',
    // Lazy-load route components for better performance
    component: () => import('../features/practice/TutorPracticeCenterView.vue'),
    meta: { level: 1, tabRoot: true, title: '刷题中心', headerIcon: PageHeaderIcon.Practice, requiresCandidate: true }
  },
  {
    path: '/vue/practice/session',
    name: 'VuePracticeSession',
    redirect: (to) => ({ path: '/vue/practice', query: to.query }),
    meta: { level: 1, title: '刷题中心', headerIcon: PageHeaderIcon.Practice, fallbackPath: '/vue/practice', requiresCandidate: true }
  },
  {
    path: '/vue/practice/objective-session',
    name: 'VueObjectivePracticeSession',
    component: () => import('../features/practice/TutorPracticeSessionView.vue'),
    meta: {
      level: 2,
      title: '做题',
      fallbackPath: '/vue/practice',
      requiresCandidate: true,
      floatingActionBottom: 76
    }
  },
  {
    path: '/vue/exam',
    name: 'VueExam',
    component: () => import('../views/ExamView.vue'),
    meta: { level: 2, title: '模拟考试', fallbackPath: '/vue/study', requiresCandidate: true }
  },
  {
    path: '/vue/essay',
    name: 'VueEssay',
    component: () => import('../views/EssayView.vue'),
    meta: { level: 2, title: '申论中心', fallbackPath: '/vue/practice', requiresCandidate: true }
  },
  {
    path: '/vue/wrongbook',
    name: 'VueWrongBook',
    component: () => import('../features/wrongbook/TutorWrongBookView.vue'),
    meta: { level: 1, tabRoot: true, title: '错题本', headerIcon: PageHeaderIcon.WrongBook, requiresCandidate: true }
  },
  {
    path: '/vue/profile',
    name: 'VueProfile',
    component: () => import('../views/ProfileView.vue'),
    meta: { level: 1, tabRoot: true, title: '我的', headerIcon: PageHeaderIcon.Profile }
  },
  {
    path: '/vue/onboarding',
    name: 'VueOnboarding',
    component: () => import('../features/onboarding/OnboardingView.vue'),
    meta: { level: 2, title: '建立备考档案', fallbackPath: '/vue/profile' }
  },
  {
    path: '/vue/calendar',
    name: 'VueCalendar',
    component: () => import('../views/CalendarView.vue'),
    meta: { level: 2, title: '练习日历', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/plan',
    name: 'VuePlan',
    component: () => import('../features/planning/TutorPlanView.vue'),
    meta: { level: 2, title: '备考计划', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/digest',
    name: 'VueDigest',
    component: () => import('../views/DigestView.vue'),
    meta: { level: 2, title: '每日积累', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/monthly-digest',
    name: 'VueMonthlyDigest',
    component: () => import('../views/MonthlyDigestView.vue'),
    meta: { level: 3, title: '时政月报', fallbackPath: '/vue/digest', requiresCandidate: true }
  },
  {
    path: '/vue/interview',
    name: 'VueInterview',
    component: () => import('../views/InterviewView.vue'),
    meta: { level: 2, title: '面试模拟', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/quality-dashboard',
    name: 'VueQualityDashboard',
    component: () => import('../views/QualityDashboardView.vue'),
    meta: { level: 2, title: '质量追踪', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/knowledge-graph',
    name: 'VueKnowledgeGraph',
    component: () => import('../views/KnowledgeGraphView.vue'),
    meta: { level: 2, title: '知识地图', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/error-report',
    name: 'VueErrorReport',
    component: () => import('../views/ErrorReportView.vue'),
    meta: { level: 2, title: '错因报告', fallbackPath: '/vue/wrongbook', requiresCandidate: true }
  },
  {
    path: '/vue/sprint',
    name: 'VueSprint',
    component: () => import('../views/SprintView.vue'),
    meta: { level: 2, title: '考前冲刺', fallbackPath: '/', requiresCandidate: true }
  },
  {
    path: '/vue/study',
    name: 'VueStudy',
    component: () => import('../views/LearningCenterView.vue'),
    meta: { level: 1, tabRoot: true, title: '学习中心', headerIcon: PageHeaderIcon.Study, requiresCandidate: true }
  },
  {
    path: '/vue/study/lecture',
    name: 'VueStudyLecture',
    component: () => import('../views/StudyView.vue'),
    meta: { level: 2, title: '考点精讲', fallbackPath: '/vue/study', requiresCandidate: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/vue'
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

router.beforeEach(requireCandidateCycle);

export default router;
