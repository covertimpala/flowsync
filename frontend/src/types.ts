export type ItemStatus = 'confirmed' | 'pending';
export type TaskOrigin = 'local' | 'ai' | 'api';
export type CalendarSource = 'local' | 'ai' | 'api' | 'google' | 'outlook' | 'ics';
export type TaskPriority = 'low' | 'medium' | 'high';
export type HabitFrequency = 'daily' | 'weekly' | 'custom';
export type BudgetEntryType = 'expense' | 'income';

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
  origin: TaskOrigin;
  status: ItemStatus;
  created_by: string | null;
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
}

export interface BudgetEntry {
  id: number;
  category_id: number;
  amount_cents: number;
  type: BudgetEntryType;
  date: string;
  note: string | null;
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
}

export interface ScheduleResponse {
  events: CalendarEvent[];
  planned: { task: Task; start: string; end: string }[];
  unscheduled: Task[];
}

export interface DeviceCodeInfo {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}
