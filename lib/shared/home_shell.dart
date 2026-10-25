import 'package:flutter/material.dart';

import '../features/budget/budget_screen.dart';
import '../features/calendar/calendar_screen.dart';
import '../features/habits/habits_screen.dart';
import '../features/schedule/schedule_screen.dart';

const _destinations = [
  (icon: Icons.today, label: 'Today'),
  (icon: Icons.calendar_month, label: 'Calendar'),
  (icon: Icons.local_fire_department, label: 'Habits'),
  (icon: Icons.account_balance_wallet, label: 'Budget'),
];

const _screens = [
  ScheduleScreen(),
  CalendarScreen(),
  HabitsScreen(),
  BudgetScreen(),
];

/// Top-level navigation. Uses a side [NavigationRail] on wide windows
/// (Windows desktop) and a bottom [NavigationBar] on narrow ones (Android
/// phones), switching at a conventional 600px breakpoint.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 600;

    if (isWide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final d in _destinations)
                  NavigationRailDestination(icon: Icon(d.icon), label: Text(d.label)),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(child: _screens[_index]),
          ],
        ),
      );
    }

    return Scaffold(
      body: _screens[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final d in _destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
      ),
    );
  }
}
