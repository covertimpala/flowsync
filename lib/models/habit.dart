enum HabitFrequency { daily, weekly, custom }

class Habit {
  final int? id;
  final String name;
  final String? icon;
  final HabitFrequency frequency;

  /// For [HabitFrequency.custom]: which weekdays (1=Mon..7=Sun) it applies to.
  final List<int> customDays;

  /// Points earned each time the habit is completed. Feeds the rewards
  /// system in [features/habits/habit_rewards.dart].
  final int pointsPerCompletion;

  final int currentStreak;
  final int bestStreak;
  final bool archived;

  const Habit({
    this.id,
    required this.name,
    this.icon,
    this.frequency = HabitFrequency.daily,
    this.customDays = const [],
    this.pointsPerCompletion = 10,
    this.currentStreak = 0,
    this.bestStreak = 0,
    this.archived = false,
  });

  Habit copyWith({
    String? name,
    String? icon,
    HabitFrequency? frequency,
    List<int>? customDays,
    int? pointsPerCompletion,
    int? currentStreak,
    int? bestStreak,
    bool? archived,
  }) {
    return Habit(
      id: id,
      name: name ?? this.name,
      icon: icon ?? this.icon,
      frequency: frequency ?? this.frequency,
      customDays: customDays ?? this.customDays,
      pointsPerCompletion: pointsPerCompletion ?? this.pointsPerCompletion,
      currentStreak: currentStreak ?? this.currentStreak,
      bestStreak: bestStreak ?? this.bestStreak,
      archived: archived ?? this.archived,
    );
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'name': name,
        'icon': icon,
        'frequency': frequency.name,
        'custom_days': customDays.join(','),
        'points_per_completion': pointsPerCompletion,
        'current_streak': currentStreak,
        'best_streak': bestStreak,
        'archived': archived ? 1 : 0,
      };

  factory Habit.fromMap(Map<String, Object?> map) => Habit(
        id: map['id'] as int?,
        name: map['name'] as String,
        icon: map['icon'] as String?,
        frequency: HabitFrequency.values.byName(map['frequency'] as String),
        customDays: (map['custom_days'] as String).isEmpty
            ? const []
            : (map['custom_days'] as String)
                .split(',')
                .map(int.parse)
                .toList(),
        pointsPerCompletion: map['points_per_completion'] as int,
        currentStreak: map['current_streak'] as int,
        bestStreak: map['best_streak'] as int,
        archived: (map['archived'] as int) == 1,
      );
}

class HabitLog {
  final int? id;
  final int habitId;
  final DateTime completedOn;

  const HabitLog({this.id, required this.habitId, required this.completedOn});

  Map<String, Object?> toMap() => {
        'id': id,
        'habit_id': habitId,
        'completed_on': completedOn.toIso8601String(),
      };

  factory HabitLog.fromMap(Map<String, Object?> map) => HabitLog(
        id: map['id'] as int?,
        habitId: map['habit_id'] as int,
        completedOn: DateTime.parse(map['completed_on'] as String),
      );
}

class Reward {
  final int? id;
  final String name;
  final int pointCost;
  final bool redeemed;

  const Reward({
    this.id,
    required this.name,
    required this.pointCost,
    this.redeemed = false,
  });

  Reward copyWith({bool? redeemed}) => Reward(
        id: id,
        name: name,
        pointCost: pointCost,
        redeemed: redeemed ?? this.redeemed,
      );

  Map<String, Object?> toMap() => {
        'id': id,
        'name': name,
        'point_cost': pointCost,
        'redeemed': redeemed ? 1 : 0,
      };

  factory Reward.fromMap(Map<String, Object?> map) => Reward(
        id: map['id'] as int?,
        name: map['name'] as String,
        pointCost: map['point_cost'] as int,
        redeemed: (map['redeemed'] as int) == 1,
      );
}
