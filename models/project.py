from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from enum import Enum


class ProjectStatus(str, Enum):
    DRAFT = "draft"
    ANALYZING = "analyzing"
    GENERATING = "generating"
    REVIEW = "review"
    DONE = "done"


class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: ProjectStatus = ProjectStatus.DRAFT
    source_files: list[str] = []
    created_at: str = ""
    updated_at: str = ""
