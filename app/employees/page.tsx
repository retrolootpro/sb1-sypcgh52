'use client';

import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Target, DollarSign, Package, ShoppingCart, Calendar, ShoppingBag, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { getAllEnhancedEmployeePerformances, type EnhancedEmployeePerformance } from '@/lib/api-services';
import { AddEmployeeDialog } from '@/components/add-employee-dialog';
import { SetGoalDialog } from '@/components/set-goal-dialog';

export default function EmployeesPage() {
  const [employeePerformances, setEmployeePerformances] = useState<EnhancedEmployeePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('today');

  const loadPerformances = async () => {
    setLoading(true);
    try {
      const now = new Date();
      let startDate: string | undefined;

      if (dateRange === 'today') {
        startDate = now.toISOString().split('T')[0];
      } else if (dateRange === 'week') {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (dateRange === 'month') {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        startDate = monthAgo.toISOString().split('T')[0];
      }

      const performances = await getAllEnhancedEmployeePerformances(startDate);
      setEmployeePerformances(performances);
    } catch (error) {
      console.error('Error loading employee performances:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPerformances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  const getGoalProgress = (actual: number, target: number): number => {
    if (target === 0) return 0;
    return Math.min((actual / target) * 100, 100);
  };

  const handleSetGoal = (employeeId: string) => {
    setSelectedEmployeeId(employeeId);
    setGoalDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="p-8 lg:p-10 space-y-8 max-w-6xl">
        <div className="flex justify-between items-start">
          <div>
            <div className="label-caps mb-1">Business</div>
            <h1 className="heading-lg text-[22px]">Employees</h1>
          </div>
          <Button size="sm" className="h-9" onClick={() => setAddEmployeeOpen(true)}>
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
            Add Employee
          </Button>
        </div>

        <div className="flex gap-1.5">
          {(['today', 'week', 'month'] as const).map((range) => (
            <Button
              key={range}
              variant={dateRange === range ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setDateRange(range)}
            >
              {range === 'today' ? 'Today' : range === 'week' ? 'This Week' : 'This Month'}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : employeePerformances.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card">
            <div className="flex flex-col items-center justify-center py-16">
              <UserPlus className="w-10 h-10 mb-3 text-muted-foreground/20" />
              <h3 className="text-sm font-medium mb-1">No employees yet</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Add your first employee to start tracking performance
              </p>
              <Button size="sm" onClick={() => setAddEmployeeOpen(true)}>
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                Add Employee
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {employeePerformances.map(({ employee, goals, metrics, shows_managed, ebay_listings, ebay_sales }) => {
              const scannedGoal = goals.find(g => g.goal_type === 'items_scanned');
              const soldGoal = goals.find(g => g.goal_type === 'items_sold');
              const revenueGoal = goals.find(g => g.goal_type === 'revenue');

              return (
                <div key={employee.id} className="rounded-2xl border border-border/40 bg-card p-5 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-sm">{employee.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {employee.email || 'No email'}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${employee.is_active ? 'border-emerald-500/30 text-emerald-400' : 'border-border/60 text-muted-foreground'}`}
                    >
                      {employee.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <Package className="h-3.5 w-3.5 text-primary" />
                          <span>Items Scanned</span>
                        </div>
                        <span className="text-xs font-semibold">
                          {metrics.items_scanned}
                          {scannedGoal && ` / ${scannedGoal.target_value}`}
                        </span>
                      </div>
                      {scannedGoal && (
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${getGoalProgress(metrics.items_scanned, scannedGoal.target_value)}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <ShoppingCart className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Items Sold</span>
                        </div>
                        <span className="text-xs font-semibold">
                          {metrics.items_sold}
                          {soldGoal && ` / ${soldGoal.target_value}`}
                        </span>
                      </div>
                      {soldGoal && (
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 rounded-full transition-all"
                            style={{ width: `${getGoalProgress(metrics.items_sold, soldGoal.target_value)}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <DollarSign className="h-3.5 w-3.5 text-amber-400" />
                          <span>Revenue</span>
                        </div>
                        <span className="text-xs font-semibold">
                          ${metrics.revenue.toFixed(2)}
                          {revenueGoal && ` / $${revenueGoal.target_value}`}
                        </span>
                      </div>
                      {revenueGoal && (
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all"
                            style={{ width: `${getGoalProgress(metrics.revenue, revenueGoal.target_value)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-border/40 pt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Shows Managed</span>
                      </div>
                      <span className="font-semibold">{shows_managed}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="h-3.5 w-3.5 text-orange-400" />
                        <span>eBay Listings</span>
                      </div>
                      <span className="font-semibold">{ebay_listings}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" />
                        <span>eBay Sales</span>
                      </div>
                      <span className="font-semibold">{ebay_sales}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => handleSetGoal(employee.id)}
                    >
                      <Target className="w-3.5 h-3.5 mr-1.5" />
                      {goals.length > 0 ? 'Update Goals' : 'Set Goals'}
                    </Button>
                    <Link href={`/employees/${employee.id}`}>
                      <Button size="sm" className="h-8 text-xs px-3">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Workspace
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddEmployeeDialog
        open={addEmployeeOpen}
        onOpenChange={setAddEmployeeOpen}
        onEmployeeAdded={loadPerformances}
      />

      {selectedEmployeeId && (
        <SetGoalDialog
          open={goalDialogOpen}
          onOpenChange={setGoalDialogOpen}
          employeeId={selectedEmployeeId}
          onGoalSet={loadPerformances}
        />
      )}
    </DashboardLayout>
  );
}
