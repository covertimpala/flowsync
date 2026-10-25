import '../../data/app_database.dart';
import '../../models/budget.dart';

class CategorySpend {
  final BudgetCategory category;
  final int spentCents;
  const CategorySpend(this.category, this.spentCents);

  bool get overLimit => category.monthlyLimitCents > 0 && spentCents > category.monthlyLimitCents;
  double get fractionUsed =>
      category.monthlyLimitCents == 0 ? 0 : spentCents / category.monthlyLimitCents;
}

class BudgetRepository {
  BudgetRepository(this._db);
  final AppDatabase _db;

  Future<List<BudgetCategory>> categories() async {
    final rows = await _db.db.query('budget_categories', orderBy: 'name ASC');
    return rows.map(BudgetCategory.fromMap).toList();
  }

  Future<BudgetCategory> createCategory(BudgetCategory category) async {
    final id = await _db.db.insert('budget_categories', category.toMap()..remove('id'));
    return BudgetCategory(id: id, name: category.name, monthlyLimitCents: category.monthlyLimitCents);
  }

  Future<BudgetEntry> addEntry(BudgetEntry entry) async {
    final id = await _db.db.insert('budget_entries', entry.toMap()..remove('id'));
    return BudgetEntry(
      id: id,
      categoryId: entry.categoryId,
      amountCents: entry.amountCents,
      type: entry.type,
      date: entry.date,
      note: entry.note,
    );
  }

  Future<void> deleteEntry(int id) async {
    await _db.db.delete('budget_entries', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<BudgetEntry>> entriesForMonth(DateTime month) async {
    final start = DateTime(month.year, month.month, 1);
    final end = DateTime(month.year, month.month + 1, 1);
    final rows = await _db.db.query(
      'budget_entries',
      where: 'date >= ? AND date < ?',
      whereArgs: [start.toIso8601String(), end.toIso8601String()],
      orderBy: 'date DESC',
    );
    return rows.map(BudgetEntry.fromMap).toList();
  }

  /// Per-category spend (expenses only) for the given month, for the
  /// progress bars / warnings shown in the budget screen.
  Future<List<CategorySpend>> spendByCategoryForMonth(DateTime month) async {
    final cats = await categories();
    final entries = await entriesForMonth(month);
    return cats.map((c) {
      final spent = entries
          .where((e) => e.categoryId == c.id && e.type == BudgetEntryType.expense)
          .fold<int>(0, (sum, e) => sum + e.amountCents);
      return CategorySpend(c, spent);
    }).toList();
  }

  Future<int> netForMonth(DateTime month) async {
    final entries = await entriesForMonth(month);
    return entries.fold<int>(0, (sum, e) {
      return sum + (e.type == BudgetEntryType.income ? e.amountCents : -e.amountCents);
    });
  }
}
