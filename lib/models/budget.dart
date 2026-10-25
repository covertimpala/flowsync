class BudgetCategory {
  final int? id;
  final String name;

  /// Monthly limit in minor currency units (e.g. cents) to avoid float
  /// rounding issues. 0 means "no limit, tracking only".
  final int monthlyLimitCents;

  const BudgetCategory({
    this.id,
    required this.name,
    this.monthlyLimitCents = 0,
  });

  Map<String, Object?> toMap() => {
        'id': id,
        'name': name,
        'monthly_limit_cents': monthlyLimitCents,
      };

  factory BudgetCategory.fromMap(Map<String, Object?> map) => BudgetCategory(
        id: map['id'] as int?,
        name: map['name'] as String,
        monthlyLimitCents: map['monthly_limit_cents'] as int,
      );
}

enum BudgetEntryType { expense, income }

class BudgetEntry {
  final int? id;
  final int categoryId;
  final int amountCents;
  final BudgetEntryType type;
  final DateTime date;
  final String? note;

  const BudgetEntry({
    this.id,
    required this.categoryId,
    required this.amountCents,
    required this.type,
    required this.date,
    this.note,
  });

  Map<String, Object?> toMap() => {
        'id': id,
        'category_id': categoryId,
        'amount_cents': amountCents,
        'type': type.name,
        'date': date.toIso8601String(),
        'note': note,
      };

  factory BudgetEntry.fromMap(Map<String, Object?> map) => BudgetEntry(
        id: map['id'] as int?,
        categoryId: map['category_id'] as int,
        amountCents: map['amount_cents'] as int,
        type: BudgetEntryType.values.byName(map['type'] as String),
        date: DateTime.parse(map['date'] as String),
        note: map['note'] as String?,
      );
}
