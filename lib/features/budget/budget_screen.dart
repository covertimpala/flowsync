import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/budget.dart';
import '../../shared/providers.dart';
import 'budget_repository.dart';

class BudgetScreen extends ConsumerStatefulWidget {
  const BudgetScreen({super.key});
  @override
  ConsumerState<BudgetScreen> createState() => _BudgetScreenState();
}

class _BudgetScreenState extends ConsumerState<BudgetScreen> {
  final _month = DateTime.now();
  List<BudgetCategory> _categories = [];
  List<CategorySpend> _spend = [];
  int _net = 0;
  bool _loading = true;

  static final _money = NumberFormat.currency(symbol: '\$');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final repo = ref.read(budgetRepositoryProvider);
    final categories = await repo.categories();
    final spend = await repo.spendByCategoryForMonth(_month);
    final net = await repo.netForMonth(_month);
    setState(() {
      _categories = categories;
      _spend = spend;
      _net = net;
      _loading = false;
    });
  }

  Future<void> _addCategory() async {
    final nameController = TextEditingController();
    final limitController = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New category'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: nameController, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. Groceries')),
            TextField(controller: limitController, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Monthly limit (optional)')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (result != true || nameController.text.trim().isEmpty) return;
    final limitDollars = double.tryParse(limitController.text) ?? 0;
    await ref.read(budgetRepositoryProvider).createCategory(
          BudgetCategory(name: nameController.text.trim(), monthlyLimitCents: (limitDollars * 100).round()),
        );
    await _load();
  }

  Future<void> _addEntry() async {
    if (_categories.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a category first')));
      return;
    }
    BudgetCategory selected = _categories.first;
    BudgetEntryType type = BudgetEntryType.expense;
    final amountController = TextEditingController();
    final noteController = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('New entry'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<BudgetCategory>(
                initialValue: selected,
                items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c.name))).toList(),
                onChanged: (c) => setDialogState(() => selected = c!),
              ),
              SegmentedButton<BudgetEntryType>(
                segments: const [
                  ButtonSegment(value: BudgetEntryType.expense, label: Text('Expense')),
                  ButtonSegment(value: BudgetEntryType.income, label: Text('Income')),
                ],
                selected: {type},
                onSelectionChanged: (s) => setDialogState(() => type = s.first),
              ),
              TextField(controller: amountController, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Amount')),
              TextField(controller: noteController, decoration: const InputDecoration(hintText: 'Note (optional)')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
          ],
        ),
      ),
    );
    if (result != true) return;
    final amount = double.tryParse(amountController.text) ?? 0;
    if (amount <= 0) return;

    await ref.read(budgetRepositoryProvider).addEntry(BudgetEntry(
          categoryId: selected.id!,
          amountCents: (amount * 100).round(),
          type: type,
          date: DateTime.now(),
          note: noteController.text.trim().isEmpty ? null : noteController.text.trim(),
        ));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    return Scaffold(
      appBar: AppBar(title: Text('Budget · ${DateFormat.yMMMM().format(_month)}')),
      floatingActionButton: FloatingActionButton(onPressed: _addEntry, child: const Icon(Icons.add)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Net this month', style: TextStyle(fontWeight: FontWeight.bold)),
                  Text(
                    _money.format(_net / 100),
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: _net >= 0 ? Colors.green : Colors.red,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          for (final s in _spend)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(s.category.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(
                          s.category.monthlyLimitCents > 0
                              ? '${_money.format(s.spentCents / 100)} / ${_money.format(s.category.monthlyLimitCents / 100)}'
                              : _money.format(s.spentCents / 100),
                        ),
                      ],
                    ),
                    if (s.category.monthlyLimitCents > 0) ...[
                      const SizedBox(height: 6),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: s.fractionUsed.clamp(0, 1),
                          color: s.overLimit ? Colors.red : null,
                          minHeight: 6,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton(onPressed: _addCategory, child: const Text('Add category')),
          ),
        ],
      ),
    );
  }
}
