"""Pydantic models for Orion scan state and API contracts."""

from enum import Enum

from pydantic import BaseModel


class ScanStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"


class Severity(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class Finding(BaseModel):
    agent: str
    tool: str
    severity: Severity = Severity.info
    title: str
    description: str
    evidence: str = ""
    remediation: str = ""
    component: str = ""  # which app component this vuln primarily affects


class ChainNode(BaseModel):
    id: str
    label: str
    type: str = "service"  # initial_access | credential_access | lateral_movement | exfiltration | impact | service
    finding_ref: str = ""  # title of the source Finding this node represents


class ChainEdge(BaseModel):
    from_id: str
    to_id: str
    label: str = ""
    justification: str = ""  # why this edge exists — A directly enables B


class AttackChain(BaseModel):
    nodes: list[ChainNode] = []
    edges: list[ChainEdge] = []
    narrative: str = ""  # plain-English attack path description
    mermaid: str = ""  # Mermaid flowchart LR diagram source


class PortInfo(BaseModel):
    port:     int
    protocol: str = "tcp"
    service:  str = ""
    version:  str = ""
    risk:     str = "info"  # info | low | medium | high


class ScanState(BaseModel):
    scan_id: str
    target: str
    resolved_target: str = ""
    source_repo_url: str = ""
    target_type: str = ""
    architecture_summary: str = ""
    threat_model:         str = ""
    status:               ScanStatus = ScanStatus.pending
    current_agent:        str = ""
    agents_plan:          list[str] = []
    attack_chain:         AttackChain = AttackChain()
    findings:             list[Finding] = []
    ports:                list[PortInfo] = []
    started_at:           float = 0.0        # Unix timestamp when scan began
    agent_timings:        dict[str, float] = {}  # agent → Unix timestamp when it started
    log:                  list[str] = []
    # Raw LLM token stream -- each entry is one token or a control sentinel.
    # Sentinels: "\x00START:<agent>" opens a block, "\x00END" closes it.
    llm_log: list[str] = []
    report: str = ""


class ScanRequest(BaseModel):
    target: str


class ScanResponse(BaseModel):
    scan_id: str
