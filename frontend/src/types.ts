export type ItemStatus = 'confirmed' | 'pending';
export type TaskOrigin = 'local' | 'ai' | 'api';
export type CalendarSource = 'local' | 'ai' | 'api' | 'google' | 'outlook' | 'ics';
export type TaskPriority = 'low' | 'medium' | 'high';
export type HabitFrequency = 'daily' | 'weekly' | 'custom';
export type BudgetEntryType = 'expense' | 'income';
export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  due_date: string | null;
  estimated_minutes: number;
  priority: TaskPriority;
  completed: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  category_id: number | null;
  recurrence: RecurrenceRule;
  was_rescheduled: boolean;
  origin: TaskOrigin;
  status: ItemStatus;
  created_by: string | null;
}

export interface TaskCategory {
  id: number;
  name: string;
  color: string;
}

export interface RescheduleSuggestion {
  id: number;
  task_id: number;
  task_title: string;
  suggested_start: string;
  suggested_end: string;
  reason: string;
}

export interface CalendarEvent {
  id: number;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  source: CalendarSource;
  external_id: string | null;
  status: ItemStatus;
  push_to_calendar_on_accept: boolean;
  created_by: string | null;
}

export interface Habit {
  id: number;
  name: string;
  icon: string | null;
  frequency: HabitFrequency;
  custom_days: string;
  points_per_completion: number;
  current_streak: number;
  best_streak: number;
  archived: boolean;
  origin: TaskOrigin;
  status: ItemStatus;
  created_by: string | null;
}

export interface Reward {
  id: number;
  name: string;
  point_cost: number;
  redeemed: boolean;
}

export interface BudgetCategory {
  id: number;
  name: string;
  monthly_limit_cents: number;
  hidden: boolean;
}

export interface BudgetEntry {
  id: number;
  category_id: number;
  amount_cents: number;
  type: BudgetEntryType;
  date: string;
  note: string | null;
  hidden: boolean;
}

export interface CategorySpend {
  category: BudgetCategory;
  spent_cents: number;
  over_limit: boolean;
}

export interface BudgetSummary {
  by_category: CategorySpend[];
  net_cents: number;
}

export interface PendingInbox {
  tasks: Task[];
  events: CalendarEvent[];
  habits: Habit[];
  reschedules: RescheduleSuggestion[];
}

export interface ScheduleResponse {
  events: CalendarEvent[];
  planned: { task: Task; start: string; end: string }[];
  unscheduled: Task[];
}

export interface DaySchedule extends ScheduleResponse {
  date: string;
}

export interface ScheduleRangeResponse {
  days: DaySchedule[];
}

export interface ProposedAction {
  id: number;
  plan_id: string;
  action_type: string;
  description: string;
  payload_json: string;
  status: string;
}

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}
