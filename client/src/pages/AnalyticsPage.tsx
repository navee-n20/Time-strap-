import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar, Download, TrendingUp, Clock, Target, Activity, Loader2, CalendarDays } from 'lucide-react';
import AnalyticsPanel from '@/components/AnalyticsPanel';
import { User } from '@/context/AuthContext';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import * as XLSX from 'xlsx';
import type { TimeEntry } from '@shared/schema';

interface AnalyticsPageProps {
  user: User;
}

export default function AnalyticsPage({ user }: AnalyticsPageProps) {
  const [dateRange, setDateRange] = useState('week');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCalendar, setShowCalendar] = useState(false);

  const isEmployeeOrManager = user.role === 'employee' || user.role === 'manager';

  const { data: timeEntries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: isEmployeeOrManager 
      ? ['/api/time-entries/employee', user.id]
      : ['/api/time-entries'],
  });

  const filteredEntries = useMemo(() => {
    const baseDate = selectedDate;
    let startDate: Date;
    let endDate: Date;

    switch (dateRange) {
      case 'today':
        startDate = startOfDay(baseDate);
        endDate = endOfDay(baseDate);
        break;
      case 'week':
        startDate = startOfWeek(baseDate, { weekStartsOn: 1 });
        endDate = endOfWeek(baseDate, { weekStartsOn: 1 });
        break;
      case 'month':
        startDate = startOfMonth(baseDate);
        endDate = endOfMonth(baseDate);
        break;
      case 'quarter':
        startDate = startOfQuarter(baseDate);
        endDate = endOfQuarter(baseDate);
        break;
      default:
        startDate = startOfWeek(baseDate, { weekStartsOn: 1 });
        endDate = endOfWeek(baseDate, { weekStartsOn: 1 });
    }

    return timeEntries.filter(entry => {
      try {
        const entryDate = parseISO(entry.date);
        return isWithinInterval(entryDate, { start: startDate, end: endDate });
      } catch {
        return false;
      }
    });
  }, [timeEntries, dateRange, selectedDate]);

  const parseDuration = (duration: string): number => {
    const match = duration.match(/(\d+)h\s*(\d+)m?/);
    if (match) {
      return parseInt(match[1]) * 60 + parseInt(match[2] || '0');
    }
    return 0;
  };

  const analyticsData = useMemo(() => {
    const totalMinutes = filteredEntries.reduce((acc, entry) => acc + parseDuration(entry.totalHours), 0);
    
    const taskMap = new Map<string, number>();
    filteredEntries.forEach(entry => {  
      const taskName = entry.projectName || 'Other';
      const minutes = parseDuration(entry.totalHours);
      taskMap.set(taskName, (taskMap.get(taskName) || 0) + minutes);
    });
    const taskHours = Array.from(taskMap.entries())
      .map(([task, minutes]) => ({ task, hours: Math.round(minutes / 60 * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 5);

    const hourlyMap = new Map<string, number>();
    filteredEntries.forEach(entry => {
      if (entry.startTime && entry.endTime) {
        const startHour = parseInt(entry.startTime.split(':')[0]);
        const endHour = parseInt(entry.endTime.split(':')[0]);
        const startMin = parseInt(entry.startTime.split(':')[1] || '0');
        const endMin = parseInt(entry.endTime.split(':')[1] || '0');
        
        for (let h = startHour; h <= endHour; h++) {
          let mins = 60;
          if (h === startHour) mins = 60 - startMin;
          if (h === endHour) mins = Math.min(mins, endMin);
          if (h === startHour && h === endHour) mins = endMin - startMin;
          
          const hourLabel = h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`;
          hourlyMap.set(hourLabel, (hourlyMap.get(hourLabel) || 0) + Math.max(0, mins));
        }
      }
    });
    
    const hours = ['9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM', '5PM', '6PM'];
    const hourlyProductivity = hours.map(hour => ({ 
      hour, 
      minutes: Math.round(hourlyMap.get(hour) || 0) 
    }));

    return {
      productiveMinutes: totalMinutes,
      idleMinutes: 0,
      neutralMinutes: 0,
      nonProductiveMinutes: 0,
      taskHours,
      toolsUsage: [],
      hourlyProductivity,
    };
  }, [filteredEntries]);
               
  const stats = useMemo(() => {
    const totalMinutes = analyticsData.productiveMinutes;                                     
    const taskCount = filteredEntries.filter(e => e.status === 'approved').length;
    const totalEntries = filteredEntries.length;
    
    const uniqueDays = new Set(filteredEntries.map(e => e.date)).size;
    const avgDailyHours = uniqueDays > 0 ? Math.round((totalMinutes / 60 / uniqueDays) * 10) / 10 : 0;
    
    const productivityScore = totalEntries > 0 
      ? Math.round((filteredEntries.filter(e => e.status === 'approved').length / totalEntries) * 100)
      : 0;

    return {
      productivityScore,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      tasksCompleted: taskCount,
      avgDailyHours,
      totalEntries,
    };
  }, [analyticsData, filteredEntries]);

  const weeklyData = useMemo(() => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    
    return days.map((day, index) => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + index);
      const dateStr = format(dayDate, 'yyyy-MM-dd');
      
      const dayEntries = timeEntries.filter(e => e.date === dateStr);
      const totalMinutes = dayEntries.reduce((acc, e) => acc + parseDuration(e.totalHours), 0);
      const approved = dayEntries.filter(e => e.status === 'approved').length;
      const total = dayEntries.length;
      const productivity = total > 0 ? Math.round((approved / total) * 100) : 0;
      
      return {
        day,
        hours: Math.round(totalMinutes / 60 * 10) / 10,
        productivity,
      };
    });
  }, [timeEntries, selectedDate]);

  const entriesByDate = useMemo(() => {
    const grouped: Record<string, TimeEntry[]> = {};
    timeEntries.forEach(entry => {
      if (!grouped[entry.date]) {
        grouped[entry.date] = [];
      }
      grouped[entry.date].push(entry);
    });
    return grouped;
  }, [timeEntries]);

  const datesWithEntries = useMemo(() => {
    return Object.keys(entriesByDate).map(dateStr => startOfDay(parseISO(dateStr)));
  }, [entriesByDate]);

  const handleExport = () => {
    const exportData = filteredEntries.map(entry => ({
      'Date': entry.date,
      'Employee': entry.employeeName,
      'Employee Code': entry.employeeCode,
      'Project': entry.projectName,
      'Task Description': entry.taskDescription,
      'Start Time': entry.startTime,
      'End Time': entry.endTime,
      'Duration': entry.totalHours,
      'Completion %': entry.percentageComplete,
      'Status': entry.status,
      'Quantify': entry.quantify || '',
      'Achievements': entry.achievements || '',
    }));

    if (exportData.length === 0) {
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
      { wch: 40 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics');
    XLSX.writeFile(wb, `Analytics_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="analytics-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Analytics Dashboard
          </h1>
          <p className="text-blue-200/60 text-sm">
            {isEmployeeOrManager ? 'Track your productivity and work patterns' : 'Organization-wide productivity analytics'}
          </p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger 
              className="w-40 bg-slate-800 border-blue-500/20 text-white"
              data-testid="select-date-range"
            >
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="quarter">This Quarter</SelectItem>
            </SelectContent>
          </Select>

          <Popover open={showCalendar} onOpenChange={setShowCalendar}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="bg-slate-800 border-blue-500/20 text-white">
                <CalendarDays className="w-4 h-4 mr-2" />
                Calendar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-slate-800 border-blue-500/20" align="end">
              <CalendarComponent
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    setShowCalendar(false);
                  }
                }}
                modifiers={{
                  hasEntries: datesWithEntries,
                }}
                modifiersStyles={{
                  hasEntries: {
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                    borderRadius: '4px',
                  },
                }}
              />
              <div className="p-3 border-t border-blue-500/20">
                <div className="flex items-center gap-2 text-sm text-blue-200/60">
                  <div className="w-3 h-3 rounded bg-blue-500/30" />
                  <span>Dates with entries</span>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          
          <Button 
            variant="outline" 
            className="bg-slate-800 border-blue-500/20 text-white"
            onClick={handleExport}
            disabled={filteredEntries.length === 0}
            data-testid="button-export"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border-blue-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-500/20">
                <TrendingUp className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-blue-200/60">Approval Rate</p>
                <p className="text-3xl font-bold text-white" data-testid="text-productivity-score">{stats.productivityScore}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-green-500/20">
                <Clock className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-blue-200/60">Total Hours</p>
                <p className="text-3xl font-bold text-white" data-testid="text-total-hours">
                  {stats.totalHours}h
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-purple-500/20">
                <Target className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-blue-200/60">Tasks Approved</p>
                <p className="text-3xl font-bold text-white" data-testid="text-tasks-completed">{stats.tasksCompleted}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-orange-500/20">
                <Activity className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-blue-200/60">Avg. Daily Hours</p>
                <p className="text-3xl font-bold text-white" data-testid="text-avg-hours">{stats.avgDailyHours}h</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AnalyticsPanel {...analyticsData} />

      <Card className="bg-slate-800/50 border-blue-500/20">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg text-white">Weekly Summary</CardTitle>
          <span className="text-sm text-blue-200/60">
            {format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'MMM d')} - {format(endOfWeek(selectedDate, { weekStartsOn: 1 }), 'MMM d, yyyy')}
          </span>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {weeklyData.map(({ day, hours, productivity }) => (
              <div 
                key={day}
                className="p-4 bg-slate-700/30 rounded-lg border border-blue-500/10 text-center"
              >
                <p className="text-sm text-blue-200/60 mb-2">{day}</p>
                <p className="text-2xl font-bold text-white">{hours}h</p>
                <p className={`text-xs mt-1 ${productivity > 0 ? 'text-green-400' : 'text-blue-200/40'}`}>
                  {productivity > 0 ? `${productivity}% approved` : 'No data'}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {stats.totalEntries === 0 && (
        <Card className="bg-slate-800/50 border-blue-500/20 p-8 text-center">
          <CalendarDays className="w-12 h-12 text-blue-400/40 mx-auto mb-4" />
          <p className="text-blue-200/60">No time entries found for the selected period.</p>
          <p className="text-sm text-blue-200/40 mt-1">Try selecting a different date range.</p>
        </Card>
      )}
    </div>
  );
}
