'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createEmployeeGoal, getCurrentGoals, deleteEmployeeGoal, type EmployeeGoal } from '@/lib/api-services';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

interface SetGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  onGoalSet: () => void;
}

export function SetGoalDialog({ open, onOpenChange, employeeId, onGoalSet }: SetGoalDialogProps) {
  const [goalType, setGoalType] = useState<'items_scanned' | 'revenue' | 'items_sold'>('items_scanned');
  const [targetValue, setTargetValue] = useState('');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [loading, setLoading] = useState(false);
  const [currentGoals, setCurrentGoals] = useState<EmployeeGoal[]>([]);

  useEffect(() => {
    if (open) {
      loadCurrentGoals();
    }
  }, [open, employeeId]);

  const loadCurrentGoals = async () => {
    try {
      const goals = await getCurrentGoals(employeeId);
      setCurrentGoals(goals);
    } catch (error) {
      console.error('Error loading current goals:', error);
    }
  };

  const calculateDateRange = (period: 'daily' | 'weekly' | 'monthly') => {
    const now = new Date();
    const startDate = new Date(now);
    const endDate = new Date(now);

    if (period === 'daily') {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'weekly') {
      const dayOfWeek = now.getDay();
      startDate.setDate(now.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'monthly') {
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      endDate.setMonth(endDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    }

    return {
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const value = parseFloat(targetValue);
    if (isNaN(value) || value <= 0) {
      toast.error('Please enter a valid target value');
      return;
    }

    setLoading(true);
    try {
      const { start_date, end_date } = calculateDateRange(period);

      await createEmployeeGoal({
        employee_id: employeeId,
        goal_type: goalType,
        target_value: value,
        period,
        start_date,
        end_date,
      });

      toast.success('Goal set successfully');
      setTargetValue('');
      loadCurrentGoals();
      onGoalSet();
    } catch (error) {
      console.error('Error setting goal:', error);
      toast.error('Failed to set goal');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    try {
      await deleteEmployeeGoal(goalId);
      toast.success('Goal deleted successfully');
      loadCurrentGoals();
      onGoalSet();
    } catch (error) {
      console.error('Error deleting goal:', error);
      toast.error('Failed to delete goal');
    }
  };

  const getGoalTypeLabel = (type: string) => {
    switch (type) {
      case 'items_scanned':
        return 'Items Scanned';
      case 'items_sold':
        return 'Items Sold';
      case 'revenue':
        return 'Revenue';
      default:
        return type;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Goals</DialogTitle>
          <DialogDescription>
            Set performance goals for this employee.
          </DialogDescription>
        </DialogHeader>

        {currentGoals.length > 0 && (
          <div className="space-y-2 mb-4">
            <h4 className="text-sm font-semibold">Current Goals</h4>
            <div className="space-y-2">
              {currentGoals.map((goal) => (
                <div
                  key={goal.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {getGoalTypeLabel(goal.goal_type)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Target: {goal.goal_type === 'revenue' ? `$${goal.target_value}` : goal.target_value} ({goal.period})
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteGoal(goal.id)}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-type">Goal Type</Label>
            <Select value={goalType} onValueChange={(value: any) => setGoalType(value)}>
              <SelectTrigger id="goal-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="items_scanned">Items Scanned</SelectItem>
                <SelectItem value="items_sold">Items Sold</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-value">
              Target Value {goalType === 'revenue' && '($)'}
            </Label>
            <Input
              id="target-value"
              type="number"
              step={goalType === 'revenue' ? '0.01' : '1'}
              min="0"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={goalType === 'revenue' ? '1000.00' : '50'}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="period">Period</Label>
            <Select value={period} onValueChange={(value: any) => setPeriod(value)}>
              <SelectTrigger id="period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Setting...' : 'Set Goal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
