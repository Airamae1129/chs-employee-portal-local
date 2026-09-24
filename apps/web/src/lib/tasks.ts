export type TaskStatus = "ASSIGNED" | "IN_PROGRESS" | "FOR_REVIEW" | "DONE";

export interface Task {
  id: string;
  subject: string;
  note: string | null;
  link: string | null;
  dueDate: string;
  status: TaskStatus;
  assigneeId: string;
  assignedBy: string;
  assigneeName: string;
  assignedByName: string;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  FOR_REVIEW: "For Review",
  DONE: "Done",
};

export const TASK_STATUS_TONE: Record<TaskStatus, "gray" | "gold" | "green" | "red"> = {
  ASSIGNED: "gray",
  IN_PROGRESS: "gold",
  FOR_REVIEW: "gold",
  DONE: "green",
};

// The assignee picks one of these; "Assigned" is only the starting state.
export const TASK_STATUS_CHOICES: TaskStatus[] = ["IN_PROGRESS", "FOR_REVIEW", "DONE"];

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
