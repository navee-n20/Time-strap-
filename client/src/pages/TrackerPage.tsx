import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Calendar as CalendarIcon, ChevronDown, ChevronUp, Loader2, Send, Download, FileSpreadsheet, CheckCircle, Mail, Clock, Zap, AlertCircle, Settings } from 'lucide-react';
import TaskTable, { Task } from '@/components/TaskTable';
import ShiftSelector from '@/components/ShiftSelector';
import AnalyticsPanel from '@/components/AnalyticsPanel';
import { User } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import type { TimeEntry } from '@shared/schema';

interface TrackerPageProps {
  user: User;
}

// Structure returned by /api/pending-deadline-tasks
interface PendingDeadlineTask {
  id: string;
  task_name: string;
  projectName: string;
  isAssignedToEmployee: boolean;
  end_date?: string | null;
  start_date?: string | null;
  projectCode?: string;
}

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
};

const formatTaskDescription = (task: any) => {
  let desc = task.title;
  if (task.subTask) desc += ' | ' + task.subTask;
  else desc += ' | ';
  if (task.description) desc += ' | ' + task.description;
  return desc;
};

export default function TrackerPage({ user }: TrackerPageProps) {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [shiftHours, setShiftHours] = useState<4 | 8 | 12>(8);
  const [, setLocation] = useLocation();
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showSubmissionConfirm, setShowSubmissionConfirm] = useState(false);
  const [submittedTasks, setSubmittedTasks] = useState<Task[]>([]);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [blockUnassignedTasks, setBlockUnassignedTasks] = useState(false);
  // When true, pending PMS tasks due today will block final submission (legacy behaviour).
  // Off by default – employees can submit once shift time is met.
  const [requirePmsTasksBeforeSubmit, setRequirePmsTasksBeforeSubmit] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Fetch timesheet blocking settings
  const { data: blockingSettings } = useQuery({
    queryKey: ['/api/settings/timesheet-blocking'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/settings/timesheet-blocking');
        if (!response.ok) throw new Error('Failed to fetch settings');
        const data = await response.json();
        setBlockUnassignedTasks(data.blockUnassignedProjectTasks || false);
        return data;
      } catch (error) {
        console.error('Error fetching settings:', error);
        return { blockUnassignedProjectTasks: false };
      }
    },
  });

  // Update blocking settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (blockUnassigned: boolean) => {
      const response = await fetch('/api/settings/timesheet-blocking', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockUnassignedProjectTasks: blockUnassigned }),
      });
      if (!response.ok) throw new Error('Failed to update settings');
      return response.json();
    },
    onSuccess: (data) => {
      setBlockUnassignedTasks(data.blockUnassignedProjectTasks);
      queryClient.invalidateQueries({ queryKey: ['/api/settings/timesheet-blocking'] });
      toast({
        title: "Settings Updated",
        description: `Unassigned project tasks will ${data.blockUnassignedProjectTasks ? 'now' : 'no longer'} block submission.`,
      });
    },
  });

  const formattedDate = format(selectedDate, 'yyyy-MM-dd');

  // Helper to get storage key for user's pending tasks
  const getPendingTasksKey = (userId: string, date: string) => `pendingTasks_${userId}_${date}`;

  const storageKey = getPendingTasksKey(user.id, formattedDate);

  // Initialize pendingTasks from localStorage
  const [pendingTasks, setPendingTasks] = useState<Task[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Tasks fetched from PMS that are due today but not yet added to timesheet
  const [pendingDeadlineTasks, setPendingDeadlineTasks] = useState<PendingDeadlineTask[]>([]);

  // Persist pendingTasks to localStorage whenever they change
  const updatePendingTasks = (newTasks: Task[]) => {
    setPendingTasks(newTasks);
    if (newTasks.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(newTasks));
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  // Load tasks when date changes
  const loadTasksForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const key = getPendingTasksKey(user.id, dateStr);
    try {
      const stored = localStorage.getItem(key);
      setPendingTasks(stored ? JSON.parse(stored) : []);
    } catch {
      setPendingTasks([]);
    }
  };

  // Fetch user's time entries from database
  const { data: serverEntries = [], isLoading } = useQuery<TimeEntry[]>({
    queryKey: ['/api/time-entries/employee', user.id],
  });

  // Fetch available PMS tasks for the employee
  const { data: availableTasks = [], isLoading: isLoadingPMSTasks, error: pmsError } = useQuery<any[]>({
    queryKey: ['/api/available-tasks', user.id],
    queryFn: async () => {
      try {
        console.log('[DEBUG] Fetching available PMS tasks for employee:', user.id);
        const response = await fetch(`/api/available-tasks?employeeId=${user.id}`);
        if (!response.ok) {
          console.error('[DEBUG] API response not ok:', response.status);
          return [];
        }
        const data = await response.json();
        console.log('[DEBUG] Available tasks fetched:', data);
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error('[DEBUG] Error fetching available tasks:', error);
        return [];
      }
    },
    enabled: !!user?.id,
  });

  // Filter entries for selected date
  const todaysEntries = serverEntries.filter(e => e.date === formattedDate);

  // Format task description with task and subtask
  const formatTaskDescription = (task: Task) => {
    let desc = task.title;
    if (task.subTask) {
      desc += ' | ' + task.subTask;
    } else {
      desc += ' | ';
    }
    if (task.description) {
      desc += ' | ' + task.description;
    }
    return desc;
  };

  // Create time entry mutation
  const submitMutation = useMutation({
    mutationFn: async (task: Task) => {
      const response = await apiRequest('POST', '/api/time-entries', {
        employeeId: user.id,
        employeeCode: user.employeeCode,
        employeeName: user.name,
        date: formattedDate,
        projectName: task.project,
        taskDescription: formatTaskDescription(task),
        problemAndIssues: (task as any).problemAndIssues || '',
        quantify: (task as any).quantify || '',
        achievements: (task as any).achievements || '',
        scopeOfImprovements: (task as any).scopeOfImprovements || '',
        toolsUsed: task.toolsUsed || [],
        startTime: task.startTime,
        endTime: task.endTime,
        totalHours: formatDuration(task.durationMinutes),
        percentageComplete: task.percentageComplete,
        pmsId: task.pmsId,
        pmsSubtaskId: (task as any).pmsSubtaskId,
        status: 'pending',
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to submit task. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update time entry mutation (for server entries)
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest('PUT', `/api/time-entries/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      toast({
        title: "Task Updated",
        description: "Your task has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update task. Only pending tasks can be edited.",
        variant: "destructive",
      });
    },
  });

  // Delete time entry mutation (for server entries)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/time-entries/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/time-entries'] });
      toast({
        title: "Task Deleted",
        description: "Your task has been deleted successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete task. Only pending tasks can be deleted.",
        variant: "destructive",
      });
    },
  });

  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const parseDuration = (duration: string): number => {
    const match = duration.match(/(\d+)h\s*(\d+)m?/);
    if (match) {
      return parseInt(match[1]) * 60 + parseInt(match[2] || '0');
    }
    return 0;
  };

  // Parse task description that may contain task and subtask
  const parseTaskDescription = (taskDesc: string) => {
    const parts = taskDesc.split(' | ');
    if (parts.length >= 2) {
      return { title: parts[0], subTask: parts[1], description: parts.slice(2).join(' | ') };
    }
    const colonParts = taskDesc.split(':');
    return { title: colonParts[0] || taskDesc, subTask: '', description: colonParts[1]?.trim() || '' };
  };

  // Combine pending tasks with submitted entries for display
  const allTasks: Task[] = useMemo(() => [
    // Convert server entries to Task format
    ...todaysEntries.map(entry => {
      const parsed = parseTaskDescription(entry.taskDescription);
      return {
        id: entry.id,
        project: entry.projectName,
        title: parsed.title,
        subTask: parsed.subTask,
        description: parsed.description,
        problemAndIssues: entry.problemAndIssues || '',
        quantify: entry.quantify || '',
        achievements: entry.achievements || '',
        scopeOfImprovements: entry.scopeOfImprovements || '',
        toolsUsed: entry.toolsUsed || [],
        startTime: entry.startTime,
        endTime: entry.endTime,
        durationMinutes: parseDuration(entry.totalHours),
        percentageComplete: entry.percentageComplete ?? 0,
        pmsId: entry.pmsId || undefined,
        pmsSubtaskId: entry.pmsSubtaskId || undefined,
        isComplete: entry.status === 'approved',
        serverStatus: entry.status as Task['serverStatus'],
      };
    }),
    // Add pending local tasks
    ...pendingTasks.map(t => ({ ...t, serverStatus: 'draft' as const })),
  ], [todaysEntries, pendingTasks]);

  // Apply filters to tasks
  const filteredAllTasks = useMemo(() => {
    return allTasks.filter(task => {
      const matchesProject = task.project.toLowerCase().includes(projectFilter.toLowerCase());
      const matchesTask = task.title.toLowerCase().includes(taskFilter.toLowerCase()) ||
        (task.description || '').toLowerCase().includes(taskFilter.toLowerCase());
      return matchesProject && matchesTask;
    });
  }, [allTasks, projectFilter, taskFilter]);

  const filteredAvailableTasks = useMemo(() => {
    return availableTasks.filter(task => {
      const matchesProject = task.projectName.toLowerCase().includes(projectFilter.toLowerCase());
      const matchesTask = task.task_name.toLowerCase().includes(taskFilter.toLowerCase()) ||
        (task.description || '').toLowerCase().includes(taskFilter.toLowerCase());
      return matchesProject && matchesTask;
    });
  }, [availableTasks, projectFilter, taskFilter]);

  // Extract unique projects and tasks for dropdowns
  const uniqueProjects = useMemo(() => {
    const projects = new Set<string>();
    availableTasks.forEach(t => projects.add(t.projectName));
    allTasks.forEach(t => projects.add(t.project));
    return Array.from(projects).sort();
  }, [availableTasks, allTasks]);

  const uniqueTasks = useMemo(() => {
    const tasks = new Set<string>();

    // If a project is selected, only show tasks for that project
    const pmsSource = projectFilter && projectFilter !== 'all'
      ? availableTasks.filter(t => t.projectName === projectFilter)
      : availableTasks;

    const trackerSource = projectFilter && projectFilter !== 'all'
      ? allTasks.filter(t => t.project === projectFilter)
      : allTasks;

    pmsSource.forEach(t => tasks.add(t.task_name));
    trackerSource.forEach(t => tasks.add(t.title));

    return Array.from(tasks).sort();
  }, [availableTasks, allTasks, projectFilter]);

  // Update filtering logic to handle 'all'
  const filteredAllTasksDropdown = useMemo(() => {
    return allTasks.filter(task => {
      const matchesProject = !projectFilter || projectFilter === 'all' || task.project === projectFilter;
      const matchesTask = !taskFilter || taskFilter === 'all' || task.title === taskFilter;

      // For tracked tasks, compare against today's date (formattedDate)
      let matchesDateRange = true;
      if (startDateFilter && formattedDate < startDateFilter) matchesDateRange = false;
      if (endDateFilter && formattedDate > endDateFilter) matchesDateRange = false;

      return matchesProject && matchesTask && matchesDateRange;
    });
  }, [allTasks, projectFilter, taskFilter, startDateFilter, endDateFilter, formattedDate]);

  const filteredAvailableTasksDropdown = useMemo(() => {
    return availableTasks.filter(task => {
      const matchesProject = !projectFilter || projectFilter === 'all' || task.projectName === projectFilter;
      const matchesTask = !taskFilter || taskFilter === 'all' || task.task_name === taskFilter;

      // For PMS tasks, compare against deadlines or start/end dates
      const taskStart = task.start_date || task.projectStartDate;
      const taskEnd = task.taskDeadline || task.end_date || task.projectDeadline;

      let matchesDateRange = true;
      if (startDateFilter) {
        // If task has an end date, it must be >= start filter. If only start date, it must be >= start filter.
        const compareDate = taskEnd || taskStart;
        if (compareDate) {
          const formattedCompare = format(new Date(compareDate), 'yyyy-MM-dd');
          if (formattedCompare < startDateFilter) matchesDateRange = false;
        }
      }
      if (endDateFilter) {
        // If task has a start date, it must be <= end filter.
        const compareDate = taskStart || taskEnd;
        if (compareDate) {
          const formattedCompare = format(new Date(compareDate), 'yyyy-MM-dd');
          if (formattedCompare > endDateFilter) matchesDateRange = false;
        }
      }

      return matchesProject && matchesTask && matchesDateRange;
    });
  }, [availableTasks, projectFilter, taskFilter, startDateFilter, endDateFilter]);

  const totalWorkedMinutes = allTasks.reduce((acc, task) => acc + task.durationMinutes, 0);
  const canSubmit =
    pendingTasks.length > 0 &&
    totalWorkedMinutes >= shiftHours * 60 &&
    (!requirePmsTasksBeforeSubmit || pendingDeadlineTasks.length === 0);


  const handleSaveTask = async (taskData: Task) => {
    // This function is now handled in TaskEntryPage.tsx
    // Keeping minimal logic if any other direct calls exist, but normally not needed
  };

  const handleEditTask = (task: Task) => {
    setLocation(`/task-entry/${task.id}?date=${formattedDate}`);
  };

  const handleDeleteTask = async (taskId: string) => {
    // Allow deletion of local tasks OR server tasks that are still pending
    const task = allTasks.find(t => t.id === taskId);

    if (taskId.startsWith('local-')) {
      // Local task - remove from state and localStorage
      updatePendingTasks(pendingTasks.filter(t => t.id !== taskId));
    } else if (task?.serverStatus === 'pending') {
      // Server task - delete via API
      await deleteMutation.mutateAsync(taskId);
    } else {
      toast({
        title: "Cannot Delete",
        description: "Only pending tasks can be deleted.",
        variant: "destructive",
      });
    }
  };

  const handleQuickAddTask = (task: any) => {
    const params = new URLSearchParams();
    params.append('date', formattedDate);
    // @ts-ignore
    params.append('pmsId', task.id || task.pmsId || '');
    params.append('pmsTaskName', task.task_name || '');
    params.append('pmsProjectName', task.projectName || '');
    params.append('pmsDescription', task.description || '');
    setLocation(`/task-entry?${params.toString()}`);
  };

  const handleCompleteTask = (taskId: string) => {
    updatePendingTasks(pendingTasks.map(t =>
      t.id === taskId ? { ...t, isComplete: true, percentageComplete: 100 } : t
    ));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPendingDialog, setShowPendingDialog] = useState(false);

  // automatically refresh pending deadline tasks whenever date or user changes
  // helper that filters a list of PMS tasks for those due on selected date
  // and not yet added as a serverEntry or pendingTask
  const extractDueToday = (list: any[]): any[] => {
    const existingIds = new Set<string>([
      ...todaysEntries.map(e => e.id.toString()),
      ...pendingTasks.map(t => t.id.toString()),
    ]);
    return list.filter(t => {
      if (existingIds.has(t.id?.toString())) return false;
      const dt = t.end_date || t.start_date;
      if (!dt) return false;
      try {
        return format(new Date(dt), 'yyyy-MM-dd') === formattedDate;
      } catch {
        return false;
      }
    });
  };

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const res = await fetch(`/api/pending-deadline-tasks?employeeId=${user.id}&date=${formattedDate}`);
        let serverPending: any[] = [];
        if (res.ok) {
          const data = await res.json();
          console.debug('[Tracker] pending-deadline response', formattedDate, data);
          serverPending = Array.isArray(data) ? data : [];
        } else {
          console.debug('[Tracker] pending-deadline fetch returned non-ok', res.status);
        }
        // also include availableTasks due today that aren't already represented
        const dueFromAvailable = extractDueToday(availableTasks);
        // merge preserving unique ids (string)
        const combined = [...serverPending];
        dueFromAvailable.forEach(t => {
          if (!combined.some(x => x.id === t.id)) combined.push(t);
        });
        setPendingDeadlineTasks(combined);
      } catch (e) {
        console.error('Failed to fetch pending deadline tasks in effect', e);
        // fallback to availableTasks if any
        setPendingDeadlineTasks(extractDueToday(availableTasks));
      }
    };
    load();
  }, [formattedDate, user, availableTasks]);

  // Update type to include 'acknowledge'
  const [postponeForm, setPostponeForm] = useState<Record<string, { selected: boolean; reason: string; newDate: string; action: 'extend' | 'keep' }>>({});

  const handleFinalSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Check for pending deadline tasks for this employee on this date
      // Only block submission when the feature is explicitly enabled in Settings.
      if (requirePmsTasksBeforeSubmit) {
        try {
          const res = await fetch(`/api/pending-deadline-tasks?employeeId=${user.id}&date=${formattedDate}`);
          let pending: any[] = [];
          if (res.ok) {
            pending = await res.json();
          }
          // if backend returned none, fall back to availableTasks due today
          if ((!Array.isArray(pending) || pending.length === 0) && availableTasks.length > 0) {
            pending = extractDueToday(availableTasks);
          }
          if (Array.isArray(pending) && pending.length > 0) {
            // have tasks due today – let the user know before showing the dialog
            toast({
              title: 'Pending PMS Tasks',
              description: 'Some tasks are due today and must be postponed or acknowledged before you can submit.',
            });
            // require user to postpone or complete them first
            setPendingDeadlineTasks(pending);
            // initialize form
            const formState: any = {};
            pending.forEach((t: any) => {
              formState[t.id] = { selected: false, reason: '', newDate: '', action: 'extend' }; // Default to extend
            });
            setPostponeForm(formState);
            setShowPendingDialog(true);
            setIsSubmitting(false);
            return; // halt submission until user resolves
          }
        } catch (err) {
          console.error('Failed to check pending deadline tasks', err);
        }
      }

      // Validation: ensure there are tasks to submit and shift target met
      if (pendingTasks.length === 0) {
        toast({ title: 'Nothing to submit', description: 'Please add at least one task before submitting.', variant: 'destructive' });
        setIsSubmitting(false);
        return;
      }
      if (totalWorkedMinutes < shiftHours * 60) {
        toast({ title: 'Shift incomplete', description: 'You have not reached your shift target yet.', variant: 'destructive' });
        setIsSubmitting(false);
        return;
      }

      // Store tasks for confirmation display
      const tasksToSubmit = [...pendingTasks];

      // Submit all pending tasks to database
      for (const task of pendingTasks) {
        await apiRequest('POST', '/api/time-entries', {
          employeeId: user.id,
          employeeCode: user.employeeCode,
          employeeName: user.name,
          date: formattedDate,
          projectName: task.project,
          taskDescription: formatTaskDescription(task),
          problemAndIssues: (task as any).problemAndIssues || '',
          quantify: (task as any).quantify || '',
          achievements: (task as any).achievements || '',
          scopeOfImprovements: (task as any).scopeOfImprovements || '',
          toolsUsed: task.toolsUsed || [],
          startTime: task.startTime,
          endTime: task.endTime,
          totalHours: formatDuration(task.durationMinutes),
          percentageComplete: task.percentageComplete,
          pmsId: task.pmsId,
          pmsSubtaskId: (task as any).pmsSubtaskId,
          status: 'pending',
        });
      }

      // Send email notification to managers
      try {
        await apiRequest('POST', '/api/notifications/timesheet-submitted', {
          employeeId: user.id,
          employeeName: user.name,
          employeeCode: user.employeeCode,
          date: formattedDate,
          taskCount: tasksToSubmit.length,
          totalHours: formatDuration(tasksToSubmit.reduce((acc, t) => acc + t.durationMinutes, 0)),
        });
      } catch (emailError) {
        console.log('Email notification skipped');
      }

      // Save submitted tasks for display and show confirmation
      setSubmittedTasks(tasksToSubmit);
      setShowSubmissionConfirm(true);

      toast({
        title: "Timesheet Submitted",
        description: "Your timesheet has been sent for approval.",
      });
    } catch (error) {
      toast({
        title: "Submission Failed",
        description: "Some tasks failed to submit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePostponeSubmit = async () => {
    // Validate all selected pending tasks
    const toProcess = pendingDeadlineTasks.filter(t => postponeForm[t.id]?.selected);

    if (toProcess.length === 0) {
      toast({ title: 'Validation', description: 'Please select tasks to resolve', variant: 'destructive' });
      return;
    }

    for (const t of toProcess) {
      const f = postponeForm[t.id];
      if (f.action === 'extend' && (!f.reason || !f.newDate)) {
        toast({ title: 'Validation', description: 'Please provide reason and new date for extending tasks', variant: 'destructive' });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // Process each task based on action
      for (const t of toProcess) {
        const f = postponeForm[t.id];

        if (f.action === 'extend') {
          await apiRequest('POST', `/api/tasks/${t.id}/postpone`, {
            taskName: t.task_name,
            previousDueDate: t.end_date || t.start_date || null,
            newDueDate: f.newDate,
            reason: f.reason,
            postponedBy: user.id,
          });
        } else {
          // Acknowledge logic
          await apiRequest('POST', `/api/tasks/${t.id}/acknowledge`, {
            acknowledgedBy: user.id,
            projectCode: t.projectCode
          });
        }
      }

      // close dialog and continue to submit timesheet automatically
      setShowPendingDialog(false);
      toast({ title: 'Resolved', description: 'Deadline tasks resolved. Submitting timesheet...' });

      // Re-run final submit flow
      await handleFinalSubmit();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error', description: 'Failed to process tasks', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearPendingTasksAndReload = () => {
    updatePendingTasks([]);
    setShowSubmissionConfirm(false);
    queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user.id] });
  };

  // Export to Excel function
  const handleExportToExcel = () => {
    // Prepare data for export
    const exportData = serverEntries.map(entry => ({
      'Date': entry.date,
      'Employee Code': entry.employeeCode,
      'Employee Name': entry.employeeName,
      'Project Name': entry.projectName,
      'Task Description': entry.taskDescription,
      'Start Time': entry.startTime,
      'End Time': entry.endTime,
      'Total Hours': entry.totalHours,
      'Status': entry.status ? entry.status.charAt(0).toUpperCase() + entry.status.slice(1) : 'Pending',
      'Submitted At': entry.submittedAt ? format(new Date(entry.submittedAt), 'yyyy-MM-dd HH:mm') : '',
      'Approved By': entry.approvedBy || '',
      'Approved At': entry.approvedAt ? format(new Date(entry.approvedAt), 'yyyy-MM-dd HH:mm') : '',
    }));

    if (exportData.length === 0) {
      toast({
        title: "No Data",
        description: "There are no time entries to export.",
        variant: "destructive",
      });
      return;
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // Date
      { wch: 14 }, // Employee Code
      { wch: 20 }, // Employee Name
      { wch: 20 }, // Project Name
      { wch: 40 }, // Task Description
      { wch: 10 }, // Start Time
      { wch: 10 }, // End Time
      { wch: 12 }, // Total Hours
      { wch: 10 }, // Status
      { wch: 18 }, // Submitted At
      { wch: 15 }, // Approved By
      { wch: 18 }, // Approved At
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Time Entries');

    // Generate filename with date range
    const fileName = `TimeEntries_${user.employeeCode}_${format(new Date(), 'yyyyMMdd')}.xlsx`;

    // Download file
    XLSX.writeFile(wb, fileName);

    toast({
      title: "Export Successful",
      description: `Downloaded ${exportData.length} time entries as Excel file.`,
    });
  };

  // Calculate live tools usage from actual tasks
  const toolsUsageMap = new Map<string, number>();
  allTasks.forEach(task => {
    if (task.toolsUsed && task.toolsUsed.length > 0) {
      const minutesPerTool = task.durationMinutes / task.toolsUsed.length;
      task.toolsUsed.forEach(tool => {
        toolsUsageMap.set(tool, (toolsUsageMap.get(tool) || 0) + minutesPerTool);
      });
    }
  });
  const liveToolsUsage = Array.from(toolsUsageMap.entries())
    .map(([tool, minutes]) => ({ tool, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes);

  // Calculate live hourly productivity from actual task times
  const hourlyMap = new Map<string, number>();
  allTasks.forEach(task => {
    if (task.startTime && task.endTime) {
      const startHour = parseInt(task.startTime.split(':')[0]);
      const endHour = parseInt(task.endTime.split(':')[0]);
      const startMin = parseInt(task.startTime.split(':')[1]);
      const endMin = parseInt(task.endTime.split(':')[1]);

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

  // Create ordered hourly data
  const hours = ['9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM', '5PM', '6PM'];
  const liveHourlyProductivity = hours
    .map(hour => ({ hour, minutes: hourlyMap.get(hour) || 0 }))
    .filter(h => h.minutes > 0 || hours.indexOf(h.hour) <= hours.findIndex(hh => hourlyMap.has(hh)));

  // Analytics data based on live tracked tasks only
  const analyticsData = {
    productiveMinutes: totalWorkedMinutes,
    idleMinutes: 0,
    neutralMinutes: 0,
    nonProductiveMinutes: 0,
    taskHours: allTasks.map(t => ({ task: t.title.slice(0, 20), hours: t.durationMinutes / 60 })),
    toolsUsage: liveToolsUsage,
    hourlyProductivity: liveHourlyProductivity.length > 0 ? liveHourlyProductivity : [],
  };

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="tracker-page">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
            Time Tracker
          </h1>
          <p className="text-blue-200/60 text-sm">
            Welcome, {user.name} ({user.employeeCode})
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="bg-slate-800 border-blue-500/20 text-white hover:bg-slate-700"
                data-testid="button-date-picker"
              >
                <CalendarIcon className="w-4 h-4 mr-2" />
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-slate-800 border-blue-500/20" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    loadTasksForDate(date);
                  }
                }}
                className="rounded-md"
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="icon"
            className="bg-slate-800 border-blue-500/20 text-blue-300 hover:bg-slate-700"
            onClick={() => setShowSettingsDialog(true)}
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <ShiftSelector
        shiftHours={shiftHours}
        onShiftChange={setShiftHours}
        totalWorkedMinutes={totalWorkedMinutes}
        onFinalSubmit={handleFinalSubmit}
        canSubmit={canSubmit}
      />

      {/* Pending Tasks Info */}
      {(pendingTasks.length > 0 || pendingDeadlineTasks.length > 0) && (
        <Card className="bg-yellow-500/10 border-yellow-500/30 p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex flex-col sm:flex-row items-center gap-2">
              {pendingDeadlineTasks.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-400" />
                    <span className="text-red-200">
                      {pendingDeadlineTasks.length} PMS task{pendingDeadlineTasks.length > 1 ? 's' : ''} due today not added
                    </span>
                  </div>
                  <ul className="text-xs text-red-100 list-disc list-inside">
                    {pendingDeadlineTasks.slice(0, 5).map(t => (
                      <li key={t.id}>{t.task_name || t.projectName || t.id}</li>
                    ))}
                    {pendingDeadlineTasks.length > 5 && <li>...and {pendingDeadlineTasks.length - 5} more</li>}
                  </ul>
                </div>
              )}
              {pendingTasks.length > 0 && (
                <div className="flex items-center gap-2">
                  <Send className="w-5 h-5 text-yellow-400" />
                  <span className="text-yellow-200">
                    {pendingTasks.length} task{pendingTasks.length > 1 ? 's' : ''} pending submission
                  </span>
                </div>
              )}
            </div>
            <Button
              onClick={handleFinalSubmit}
              disabled={submitMutation.isPending}
              className={`bg-yellow-600 hover:bg-yellow-500 ${!canSubmit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit All
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold text-white">Today's Tasks</h2>
        <Button
          onClick={() => setLocation(`/task-entry?date=${formattedDate}`)}
          className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 transition-all"
          data-testid="button-add-task"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add New Task
        </Button>
      </div>

      {/* Filters Section */}
      <Card className="bg-slate-800/50 border-blue-500/20 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-blue-200/70 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Select Project
            </label>
            <Select value={projectFilter || 'all'} onValueChange={setProjectFilter}>
              <SelectTrigger className="bg-slate-900/50 border-blue-500/20 text-white focus:border-blue-500/50">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-blue-500/30 text-white">
                <SelectItem value="all">All Projects</SelectItem>
                {uniqueProjects.map(project => (
                  <SelectItem key={project} value={project}>{project}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-blue-200/70 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Select Task
            </label>
            <Select value={taskFilter || 'all'} onValueChange={setTaskFilter}>
              <SelectTrigger className="bg-slate-900/50 border-blue-500/20 text-white focus:border-blue-500/50">
                <SelectValue placeholder="All Tasks" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-blue-500/30 text-white">
                <SelectItem value="all">All Tasks</SelectItem>
                {uniqueTasks.map(task => (
                  <SelectItem key={task} value={task}>{task}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-blue-200/70 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              Start Date
            </label>
            <Input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
              className="bg-slate-900/50 border-blue-500/20 text-white focus:border-blue-500/50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-blue-200/70 flex items-center gap-2">
              <CalendarIcon className="w-4 h-4" />
              End Date
            </label>
            <Input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
              className="bg-slate-900/50 border-blue-500/20 text-white focus:border-blue-500/50"
            />
          </div>
        </div>
      </Card>


      {isLoading || isLoadingPMSTasks ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : (
        <>
          {/* Always show available PMS tasks if any exist */}
          {filteredAvailableTasksDropdown.length > 0 && (
            <div className="space-y-3">
              <Card className="bg-cyan-500/10 border-cyan-500/30 p-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span className="text-cyan-200/70 text-sm">
                    {filteredAvailableTasksDropdown.length} task{filteredAvailableTasksDropdown.length !== 1 ? 's' : ''} available - Click to add
                  </span>
                </div>
              </Card>

              <Card className="bg-slate-800/50 border-blue-500/20 overflow-hidden">
                <div className="divide-y divide-slate-700">
                  {filteredAvailableTasksDropdown.map((task, index) => {
                    // consider task already added locally
                    const isAdded = pendingTasks.some(pt => (
                      (pt.title === task.task_name || pt.title === task.task_name.trim()) && pt.project === task.projectName
                    ));

                    // Compute overdue locally as a fallback to avoid timezone-related server issues
                    const formatDateLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const todayKey = formatDateLocal(new Date());
                    const taskDeadline = task.taskDeadline ? new Date(task.taskDeadline) : null;
                    const projectDeadline = task.projectDeadline ? new Date(task.projectDeadline) : null;
                    const taskKey = taskDeadline ? formatDateLocal(taskDeadline) : null;
                    const projectKey = projectDeadline ? formatDateLocal(projectDeadline) : null;
                    const computedTaskOverdue = taskKey ? (taskKey < todayKey) : false;
                    const computedProjectOverdue = projectKey ? (projectKey < todayKey) : false;
                    // prefer server-provided task overdue flag when available, else use computed
                    const taskOverdue = typeof task.isTaskOverdue === 'boolean' ? task.isTaskOverdue : computedTaskOverdue;
                    const projectOverdue = typeof task.isProjectOverdue === 'boolean' ? task.isProjectOverdue : computedProjectOverdue;
                    // deadline to display next to task: prefer task deadline, fallback to project deadline
                    const deadline = taskDeadline || projectDeadline;
                    const deadlineText = deadline ? deadline.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null;

                    return (
                      <div
                        key={index}
                        className={`flex items-center justify-between gap-3 p-3 transition-colors ${taskOverdue
                          ? 'bg-red-500/5 hover:bg-red-500/10'
                          : 'hover:bg-slate-700/50'
                          }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-600/50 text-blue-100 rounded whitespace-nowrap">
                              {task.projectName}
                            </span>
                            {isAdded && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-600/60 text-green-100 rounded">
                                <CheckCircle className="w-3 h-3" />
                                Added
                              </span>
                            )}
                            {taskOverdue && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-600/70 text-red-100 rounded">
                                <AlertCircle className="w-3 h-3" />
                                Deadline Over
                              </span>
                            )}
                            {!taskOverdue && projectOverdue && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-600/40 text-amber-100 rounded">
                                <AlertCircle className="w-3 h-3" />
                                Project Deadline Over
                              </span>
                            )}
                            {deadline && !taskOverdue && (
                              <span className="inline-block px-2 py-0.5 text-xs text-yellow-200/70 bg-yellow-500/10 rounded">
                                Due: {deadlineText}
                              </span>
                            )}
                            {deadline && taskOverdue && (
                              <span className="inline-block px-2 py-0.5 text-xs text-red-200 bg-red-500/10 rounded">
                                Was due: {deadlineText}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm font-medium truncate ${taskOverdue ? 'text-red-300' : 'text-white'}`}>
                            {task.task_name}
                          </p>
                          {task.description && (
                            <p className="text-blue-200/60 text-xs truncate">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <Button
                          onClick={() => {
                            if (isAdded) {
                              toast({ title: 'Already added', description: 'This task is already in your pending list.' });
                              return;
                            }
                            handleQuickAddTask(task);
                          }}
                          variant="outline"
                          size="sm"
                          disabled={isAdded}
                          className={`$${isAdded ? 'opacity-60 cursor-not-allowed' : taskOverdue
                            ? 'bg-red-700 hover:bg-red-600 border-red-500/50'
                            : 'bg-slate-700 hover:bg-slate-600 border-blue-500/30'
                            } text-white whitespace-nowrap flex-shrink-0`}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}

          {/* If fetching failed and no PMS tasks are available, show an error */}
          {availableTasks.length === 0 && pmsError && (
            <Card className="bg-red-500/10 border-red-500/30 p-4">
              <div className="flex items-start gap-3">
                <div className="text-red-400">⚠️</div>
                <div>
                  <h3 className="font-semibold text-white mb-1">Error Loading Available Tasks</h3>
                  <p className="text-red-200/70 text-sm">
                    Unable to fetch available PMS tasks. Please try again or add a task manually.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Show the user's task table when there are tasks (server or pending) */}
          {filteredAllTasksDropdown.length > 0 && (
            <TaskTable
              tasks={filteredAllTasksDropdown}
              onEdit={handleEditTask}
              onDelete={handleDeleteTask}
              onComplete={handleCompleteTask}
            />
          )}

          {/* No results message */}
          {((projectFilter && projectFilter !== 'all') || (taskFilter && taskFilter !== 'all') || startDateFilter || endDateFilter) && filteredAvailableTasksDropdown.length === 0 && filteredAllTasksDropdown.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-blue-200/40">
              <AlertCircle className="w-12 h-12 mb-4 opacity-20" />
              <p>No tasks match your filters.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setProjectFilter('all');
                  setTaskFilter('all');
                  setStartDateFilter('');
                  setEndDateFilter('');
                }}
                className="text-blue-400 hover:text-blue-300 hover:bg-transparent p-0 h-auto font-normal"
              >
                Clear Filters
              </Button>
            </div>
          )}
        </>
      )}

      <div className="border-t border-blue-500/20 pt-6">
        <Button
          variant="ghost"
          onClick={() => setShowAnalytics(!showAnalytics)}
          className="text-blue-300 hover:text-white mb-4"
          data-testid="button-toggle-analytics"
        >
          {showAnalytics ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" />
              Hide Analytics
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 mr-2" />
              Show Analytics
            </>
          )}
        </Button>

        {showAnalytics && <AnalyticsPanel {...analyticsData} />}
      </div>

      {/* Export Section */}
      <div className="border-t border-blue-500/20 pt-6">
        <Card className="bg-slate-800/50 border-blue-500/20 p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-green-500/20">
                <FileSpreadsheet className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Export Time Entries</h3>
                <p className="text-blue-200/60 text-sm">
                  Download all your time entries as an Excel file
                </p>
              </div>
            </div>
            <Button
              onClick={handleExportToExcel}
              className="bg-gradient-to-r from-green-600 to-emerald-600 text-white"
              disabled={serverEntries.length === 0}
              data-testid="button-export-excel"
            >
              <Download className="w-4 h-4 mr-2" />
              Export to Excel
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-blue-200/60 bg-slate-700/50 px-2 py-1 rounded">
              Total Entries: {serverEntries.length}
            </span>
            <span className="text-xs text-green-400/60 bg-green-500/10 px-2 py-1 rounded">
              Approved: {serverEntries.filter(e => e.status === 'approved').length}
            </span>
            <span className="text-xs text-yellow-400/60 bg-yellow-500/10 px-2 py-1 rounded">
              Pending: {serverEntries.filter(e => e.status === 'pending').length}
            </span>
            <span className="text-xs text-red-400/60 bg-red-500/10 px-2 py-1 rounded">
              Rejected: {serverEntries.filter(e => e.status === 'rejected').length}
            </span>
          </div>
        </Card>
      </div>

      {/* Submission Confirmation Dialog */}
      <Dialog open={showPendingDialog} onOpenChange={setShowPendingDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/30 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Pending Tasks Require Action</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p className="text-sm text-blue-200/70">
              You have tasks due today that are not completed. Please review each task below.
              You can choosing to <strong>Extend the Timeline</strong> or <strong>Keep the Due Date</strong> (acknowledge).
              You must resolve all pending tasks before submitting.
            </p>

            <div className="space-y-4">
              {pendingDeadlineTasks.map((t) => {
                const formState = postponeForm[t.id] || { selected: false, reason: '', newDate: '', action: 'extend' };
                return (
                  <div key={t.id} className={`bg-slate-800/40 p-4 rounded border ${formState.selected ? 'border-blue-500/50' : 'border-slate-700'}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!formState.selected}
                        onChange={(e) => setPostponeForm(prev => ({ ...prev, [t.id]: { ...formState, selected: e.target.checked } }))}
                      />
                      <div className="flex-1 space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{t.task_name}</span>
                            <span className="text-xs text-blue-200/70">({t.projectName})</span>
                            {!t.isAssignedToEmployee && (
                              <span className="ml-2 inline-block text-xs text-amber-200 bg-amber-700/10 px-2 py-0.5 rounded">Unassigned</span>
                            )}
                          </div>
                          <div className="text-xs text-yellow-200/70">Due: {t.end_date ? new Date(t.end_date).toLocaleDateString() : 'N/A'}</div>
                        </div>

                        {formState.selected && (
                          <div className="bg-slate-900/50 p-3 rounded space-y-3">
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                  type="radio"
                                  name={`action-${t.id}`}
                                  checked={formState.action === 'extend'}
                                  onChange={() => setPostponeForm(prev => ({ ...prev, [t.id]: { ...formState, action: 'extend' } }))}
                                />
                                <span className={formState.action === 'extend' ? 'text-white' : 'text-slate-400'}>Extend Timeline</span>
                              </label>
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                  type="radio"
                                  name={`action-${t.id}`}
                                  checked={formState.action === 'keep'}
                                  onChange={() => setPostponeForm(prev => ({ ...prev, [t.id]: { ...formState, action: 'keep', newDate: '', reason: '' } }))}
                                />
                                <span className={formState.action === 'keep' ? 'text-white' : 'text-slate-400'}>Keep Due Date (Acknowledge)</span>
                              </label>
                            </div>

                            {formState.action === 'extend' && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1">
                                <div className="space-y-1">
                                  <label className="text-xs text-blue-200/70">New Due Date</label>
                                  <input
                                    type="date"
                                    min={new Date().toISOString().split('T')[0]}
                                    className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm text-white"
                                    value={formState.newDate}
                                    onChange={(e) => setPostponeForm(prev => ({ ...prev, [t.id]: { ...formState, newDate: e.target.value } }))}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs text-blue-200/70">Reason</label>
                                  <input
                                    type="text"
                                    placeholder="Why is it delayed?"
                                    className="w-full bg-slate-800 border border-slate-700 p-2 rounded text-sm text-white"
                                    value={formState.reason}
                                    onChange={(e) => setPostponeForm(prev => ({ ...prev, [t.id]: { ...formState, reason: e.target.value } }))}
                                  />
                                </div>
                              </div>
                            )}

                            {formState.action === 'keep' && (
                              <div className="text-xs text-slate-400 italic">
                                Action will be logged. You can submit your timesheet but the task remains overdue.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
              <Button onClick={handlePostponeSubmit} className="bg-yellow-600 hover:bg-yellow-500">
                Confirm & Submit
              </Button>
              <Button variant="ghost" className="text-slate-400 hover:text-white" onClick={() => setShowPendingDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showSubmissionConfirm} onOpenChange={setShowSubmissionConfirm}>
        <DialogContent className="bg-slate-900 border-blue-500/30 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2 rounded-full bg-green-500/20">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              Timesheet Submitted Successfully
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-sm text-blue-200/80 bg-blue-500/10 p-3 rounded-md">
              <Mail className="w-4 h-4 text-blue-400" />
              <span>Notification sent to managers for approval</span>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                Submitted Tasks ({submittedTasks.length})
              </h4>

              <div className="bg-slate-800/50 rounded-md border border-blue-500/20 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800">
                    <tr className="text-left text-blue-200/60">
                      <th className="px-3 py-2">Task</th>
                      <th className="px-3 py-2">Project</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submittedTasks.map((task, index) => (
                      <tr key={index} className="border-t border-slate-700/50">
                        <td className="px-3 py-2 text-white">{task.title}</td>
                        <td className="px-3 py-2 text-blue-200/80">{task.project}</td>
                        <td className="px-3 py-2 text-blue-200/60">{task.startTime} - {task.endTime}</td>
                        <td className="px-3 py-2 text-cyan-400">{formatDuration(task.durationMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-800">
                    <tr className="border-t border-slate-700">
                      <td colSpan={3} className="px-3 py-2 text-right font-semibold text-white">Total:</td>
                      <td className="px-3 py-2 font-semibold text-cyan-400">
                        {formatDuration(submittedTasks.reduce((acc, t) => acc + t.durationMinutes, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-yellow-200/80 bg-yellow-500/10 p-3 rounded-md">
              <Send className="w-4 h-4 text-yellow-400" />
              <span>Status: <strong>Pending Approval</strong> - Awaiting manager review</span>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={clearPendingTasksAndReload}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 w-full"
              data-testid="button-close-confirmation"
            >
              Back to Tracker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="bg-slate-900 border-blue-500/30 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Timesheet Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-slate-800/40 p-4 rounded border border-slate-700">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-white mb-1">Unassigned Project Tasks</label>
                  <p className="text-xs text-blue-200/60">Block submission if tasks are due today but not assigned to you</p>
                </div>
                <input
                  type="checkbox"
                  checked={blockUnassignedTasks}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    setBlockUnassignedTasks(newValue);
                    updateSettingsMutation.mutate(newValue);
                  }}
                  className="w-5 h-5 cursor-pointer"
                  disabled={updateSettingsMutation.isPending}
                />
              </div>
              <div className="mt-3 text-xs text-blue-200/50">
                Status: <span className={blockUnassignedTasks ? 'text-amber-400 font-semibold' : 'text-green-400 font-semibold'}>
                  {blockUnassignedTasks ? 'BLOCKING' : 'NOT BLOCKING'}
                </span>
              </div>
            </div>

            {/* PMS Task Blocking Toggle */}
            <div className="bg-slate-800/40 p-4 rounded border border-slate-700">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-white mb-1">Require PMS Tasks Resolved Before Submit</label>
                  <p className="text-xs text-blue-200/60">When ON, employees must postpone or acknowledge all pending PMS tasks (due today) before the Final Submit is allowed</p>
                </div>
                <input
                  type="checkbox"
                  checked={requirePmsTasksBeforeSubmit}
                  onChange={(e) => setRequirePmsTasksBeforeSubmit(e.target.checked)}
                  className="w-5 h-5 cursor-pointer"
                />
              </div>
              <div className="mt-3 text-xs text-blue-200/50">
                Status: <span className={requirePmsTasksBeforeSubmit ? 'text-amber-400 font-semibold' : 'text-green-400 font-semibold'}>
                  {requirePmsTasksBeforeSubmit ? 'ENABLED (blocks on pending PMS tasks)' : 'DISABLED (submit freely after shift)'}
                </span>
              </div>
            </div>

            <div className="bg-slate-800/20 p-3 rounded border border-slate-700/50 text-xs text-blue-200/70">
              <p><strong>Current Policy:</strong></p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Unassigned project tasks: <span className={blockUnassignedTasks ? 'text-amber-400' : 'text-green-400'}>{blockUnassignedTasks ? 'WILL BLOCK' : 'will NOT block'}</span></li>
                <li>PMS task completion check: <span className={requirePmsTasksBeforeSubmit ? 'text-amber-400' : 'text-green-400'}>{requirePmsTasksBeforeSubmit ? 'REQUIRED' : 'Not required'}</span></li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setShowSettingsDialog(false)}
              className="bg-gradient-to-r from-blue-600 to-cyan-600 w-full"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

