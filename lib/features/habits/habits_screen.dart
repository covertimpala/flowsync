import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/habit.dart';
import '../../shared/providers.dart';
import 'habit_rewards.dart';

class HabitsScreen extends ConsumerStatefulWidget {
  const HabitsScreen({super.key});
  @override
  ConsumerState<HabitsScreen> createState() => _HabitsScreenState();
}

class _HabitsScreenState extends ConsumerState<HabitsScreen> {
  List<Habit> _habits = [];
  Map<int, bool> _doneToday = {};
  List<Reward> _rewards = [];
  int _points = 0;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final repo = ref.read(habitRepositoryProvider);
    final habits = await repo.activeHabits();
    final done = <int, bool>{};
    for (final h in habits) {
      done[h.id!] = await repo.completedOn(h.id!, DateTime.now());
    }
    final rewards = await repo.rewards();
    final points = await repo.availablePoints();

    setState(() {
      _habits = habits;
      _doneToday = done;
      _rewards = rewards;
      _points = points;
      _loading = false;
    });
  }

  Future<void> _toggleToday(Habit habit) async {
    final repo = ref.read(habitRepositoryProvider);
    final alreadyDone = _doneToday[habit.id] ?? false;
    if (alreadyDone) return; // habits are logged, not un-logged, once counted

    final logs = await repo.logsFor(habit.id!, lastNDays: 14);
    final previous = logs.isEmpty ? null : logs.last.completedOn;

    await repo.logCompletion(habit, DateTime.now());
    final updated = HabitRewards.markCompleted(habit, DateTime.now(), previous);
    await repo.update(updated);
    await _load();
  }

  Future<void> _addHabit() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New habit'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. Drink water, Read 20 minutes')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Add')),
        ],
      ),
    );
    if (name == null || name.trim().isEmpty) return;
    await ref.read(habitRepositoryProvider).create(Habit(name: name.trim()));
    await _load();
  }

  Future<void> _addReward() async {
    final nameController = TextEditingController();
    final costController = TextEditingController(text: '50');
    final result = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New reward'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: nameController, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. Takeout night')),
            TextField(controller: costController, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Point cost')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
        ],
      ),
    );
    if (result != true || nameController.text.trim().isEmpty) return;
    await ref.read(habitRepositoryProvider).createReward(
          Reward(name: nameController.text.trim(), pointCost: int.tryParse(costController.text) ?? 50),
        );
    await _load();
  }

  Future<void> _redeem(Reward reward) async {
    if (_points < reward.pointCost) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Need ${reward.pointCost - _points} more points')));
      return;
    }
    await ref.read(habitRepositoryProvider).redeemReward(reward.id!);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    return Scaffold(
      appBar: AppBar(
        title: const Text('Habits'),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Center(child: Chip(avatar: const Icon(Icons.star, size: 18), label: Text('$_points pts'))),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(onPressed: _addHabit, child: const Icon(Icons.add)),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 80),
        children: [
          for (final h in _habits)
            ListTile(
              leading: Checkbox(value: _doneToday[h.id] ?? false, onChanged: (_) => _toggleToday(h)),
              title: Text(h.name),
              subtitle: Text('Streak: ${h.currentStreak} 🔥  ·  Best: ${h.bestStreak}  ·  +${h.pointsPerCompletion}pts'),
            ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Row(
              children: [
                Expanded(child: Text('Rewards', style: TextStyle(fontWeight: FontWeight.bold))),
              ],
            ),
          ),
          for (final r in _rewards)
            ListTile(
              leading: Icon(r.redeemed ? Icons.check_circle : Icons.card_giftcard,
                  color: r.redeemed ? Colors.green : null),
              title: Text(r.name),
              subtitle: Text('${r.pointCost} pts'),
              trailing: r.redeemed ? const Text('Redeemed') : TextButton(onPressed: () => _redeem(r), child: const Text('Redeem')),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: OutlinedButton(onPressed: _addReward, child: const Text('Add reward')),
          ),
        ],
      ),
    );
  }
}
