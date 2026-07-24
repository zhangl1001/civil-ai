from pydantic import BaseModel
from typing import Optional
from enum import Enum


class TestType(str, Enum):
    API = "API"
    UI = "UI"
    UNIT = "UNIT"


class Priority(str, Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class TestLevel(str, Enum):
    UNIT = "单元测试"
    INTEGRATION = "集成测试"
    API = "接口测试"
    E2E = "端到端测试"


class TestStep(BaseModel):
    step: int
    action: str
    data: Optional[str] = None
    expected: Optional[str] = None


class TestCase(BaseModel):
    id: str
    module: str
    type: TestType
    priority: Priority
    title: str
    precondition: Optional[str] = None
    steps: list[TestStep]
    expectedResult: str
    testDataType: Optional[str] = "功能测试"
    tags: list[str] = []
    # Traceability fields
    covered_requirements: list[str] = []  # Requirement IDs this case covers
    test_level: Optional[str] = ""  # 单元测试/集成测试/接口测试/端到端测试
    auto_generated: bool = False  # Whether this case was AI-generated
