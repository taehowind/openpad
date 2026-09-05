import type { BoardBackground } from "@/lib/backgrounds";
export type ShareMode = "readonly" | "write";
export type BoardAudience = "link" | "members";
export type BoardType = "board" | "gallery";

export type InstructorRole = "admin" | "instructor";
export type InstructorStatus = "pending" | "active" | "disabled";

export type AccountInfo = {
  id: string;
  name: string;
  email: string;
  role: InstructorRole;
};

export type InstructorListItem = {
  id: string;
  email: string;
  name: string;
  role: InstructorRole;
  status: InstructorStatus;
  createdAt: string;
  boardCount: number;
};

export type ParticipantProfile = {
  id: string;
  nickname: string;
  emoji: string;
};

export type ActiveViewer = {
  id: string;
  nickname: string;
  emoji: string;
  actorType: "teacher" | "guest";
};

export type ChatMessage = {
  id: string;
  authorName: string;
  authorEmoji: string;
  actorType: "teacher" | "guest";
  content: string;
  createdAt: string;
  hidden: boolean;
};

export type BoardColumn = {
  id: string;
  name: string;
  color: string;
  position: number;
  gridCol: number;
};

export type BoardComment = {
  id: string;
  authorName: string;
  authorEmoji: string;
  content: string;
  createdAt: string;
};

export type BoardCard = {
  id: string;
  columnId: string;
  shareCode: string | null;
  authorId: string | null;
  authorName: string;
  authorEmoji: string;
  actorType: "teacher" | "guest";
  title: string;
  content: string;
  linkUrl: string | null;
  fileId: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  likedByMe: boolean;
  /**
   * How many comments the card has, not the comments themselves. Every open board re-fetches this
   * payload on a timer, and shipping every comment on the board to every viewer each time was the
   * largest thing in it. The bodies come from GET /api/cards/[id]/comments when a reader actually
   * opens one.
   */
  commentCount: number;
};

export type AuditEntry = {
  id: string;
  actorType: "teacher" | "guest" | "system";
  actorName: string;
  action: string;
  entityType: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type RevisionEntry = {
  id: string;
  label: string;
  kind: "auto" | "final";
  createdAt: string;
};

export type BoardPayload = {
  board: {
    id: string;
    title: string;
    description: string;
    shareMode: ShareMode;
    type: BoardType;
    background: BoardBackground;
    /** When the teacher closed the board, or null while it is open. */
    closedAt: string | null;
    shareToken?: string;
    shareCode?: string;
    audience?: BoardAudience;
    requirePassword?: boolean;
    /** Managers only; absent from a student's payload. */
    accessPassword?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  columns: BoardColumn[];
  cards: BoardCard[];
  activity: AuditEntry[];
  revisions: RevisionEntry[];
  activeViewers: ActiveViewer[];
  chatMessages: ChatMessage[];
  isAdmin: boolean;
  canWrite: boolean;
  /** False on serverless, where push cannot reach other instances; the client polls instead. */
  realtime: boolean;
  participant: ParticipantProfile | null;
};

export type BoardSummary = {
  id: string;
  title: string;
  description: string;
  shareToken: string;
  shareCode: string;
  shareMode: ShareMode;
  type: BoardType;
  background: BoardBackground;
  audience: BoardAudience;
  requirePassword: boolean;
  /** The entry code as written, so the owner's dashboard can show it. Never sent to students. */
  accessPassword?: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  participantCount: number;
};
