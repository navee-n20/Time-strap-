import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import TaskForm from '@/components/TaskForm';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import { Loader2, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Task } from '@/components/TaskTable';

// Helper to get storage key for user's pending tasks (same as in TrackerPage)
const getPendingTasksKey = (userId: string, date: string) => `pendingTasks_${userId}_${date}`;

export default function TaskEntryPage() {
    const { user } = useAuth();
    const { id } = useParams();
    const [location, setLocation] = useLocation();
    const { toast } = useToast();

    // Get date from query param or default to today
    const queryParams = new URLSearchParams(window.location.search);
    const dateStr = queryParams.get('date') || format(new Date(), 'yyyy-MM-dd');
    const pmsId = queryParams.get('pmsId');
    const pmsTaskName = queryParams.get('pmsTaskName');
    const pmsProjectName = queryParams.get('pmsProjectName');
    const pmsDescription = queryParams.get('pmsDescription');

    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isLoadingTask, setIsLoadingTask] = useState(!!id);

    // Fetch pending tasks from localStorage to find the task being edited (if it's local)
    const storageKey = user ? getPendingTasksKey(user.id, dateStr) : '';

    useEffect(() => {
        if (!id || !user) {
            // Check if it's a quick add from PMS
            if (pmsId) {
                setEditingTask({
                    id: `local-${Date.now()}`,
                    project: pmsProjectName || '',
                    title: pmsTaskName || '',
                    subTask: '',
                    description: pmsDescription || '',
                    problemAndIssues: '',
                    quantify: '1',
                    achievements: '',
                    scopeOfImprovements: '',
                    toolsUsed: ['Others'],
                    startTime: '09:00',
                    endTime: '10:00',
                    durationMinutes: 60,
                    percentageComplete: 0,
                    isComplete: false,
                    // @ts-ignore
                    pmsId: pmsId
                } as Task);
            }
            setIsLoadingTask(false);
            return;
        }

        const loadTask = async () => {
            try {
                if (id.startsWith('local-')) {
                    const stored = localStorage.getItem(storageKey);
                    if (stored) {
                        const tasks: Task[] = JSON.parse(stored);
                        const found = tasks.find(t => t.id === id);
                        if (found) setEditingTask(found);
                    }
                } else {
                    // Fetch from server
                    const response = await fetch(`/api/time-entries/${id}`);
                    if (response.ok) {
                        const entry = await response.json();
                        // Parse task description (copied logic from TrackerPage)
                        const parts = entry.taskDescription.split(' | ');
                        let parsed = { title: '', subTask: '', description: '' };
                        if (parts.length >= 2) {
                            parsed = { title: parts[0], subTask: parts[1], description: parts.slice(2).join(' | ') };
                        } else {
                            const colonParts = entry.taskDescription.split(':');
                            parsed = { title: colonParts[0] || entry.taskDescription, subTask: '', description: colonParts[1]?.trim() || '' };
                        }

                        // Duration parsing
                        const durationMatch = entry.totalHours.match(/(\d+)h\s*(\d+)m?/);
                        const durationMinutes = durationMatch ? parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2] || '0') : 0;

                        setEditingTask({
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
                            durationMinutes: durationMinutes,
                            percentageComplete: entry.percentageComplete ?? 0,
                            isComplete: entry.status === 'approved',
                            serverStatus: entry.status as Task['serverStatus'],
                            pmsId: entry.pmsId,
                            pmsSubtaskId: entry.pmsSubtaskId,
                        });
                    }
                }
            } catch (error) {
                console.error('Error loading task:', error);
                toast({ title: 'Error', description: 'Failed to load task details', variant: 'destructive' });
            } finally {
                setIsLoadingTask(false);
            }
        };

        loadTask();
    }, [id, user, storageKey, pmsId, pmsTaskName, pmsProjectName, pmsDescription]);

    // Update time entry mutation (copied logic from TrackerPage)
    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const response = await apiRequest('PUT', `/api/time-entries/${id}`, data);
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/time-entries/employee', user?.id] });
            toast({ title: "Task Updated", description: "Your task has been updated successfully." });
            setLocation('/tracker');
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to update task. Only pending tasks can be edited.", variant: "destructive" });
        },
    });

    const handleSaveTask = async (taskData: any) => {
        if (!user) return;

        const startParts = taskData.startTime.split(':').map(Number);
        const endParts = taskData.endTime.split(':').map(Number);
        const startMinutes = startParts[0] * 60 + startParts[1];
        const endMinutes = endParts[0] * 60 + endParts[1];
        const duration = endMinutes - startMinutes;

        const formatTaskDescription = (task: any) => {
            let desc = task.title;
            if (task.subTask) desc += ' | ' + task.subTask;
            else desc += ' | ';
            if (task.description) desc += ' | ' + task.description;
            return desc;
        };

        const formatDuration = (minutes: number): string => {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}m`;
        };

        if (id) {
            if (id.startsWith('local-')) {
                // Update local task
                const stored = localStorage.getItem(storageKey);
                if (stored) {
                    const tasks: Task[] = JSON.parse(stored);
                    const updatedTasks = tasks.map(t =>
                        t.id === id ? { ...t, ...taskData, durationMinutes: duration } : t
                    );
                    localStorage.setItem(storageKey, JSON.stringify(updatedTasks));
                    toast({ title: 'Task Saved', description: 'Draft task updated locally.' });
                    setLocation('/tracker');
                }
            } else {
                // Update server task
                await updateMutation.mutateAsync({
                    id: id,
                    data: {
                        projectName: taskData.project,
                        taskDescription: formatTaskDescription(taskData),
                        problemAndIssues: taskData.problemAndIssues || '',
                        quantify: taskData.quantify || '',
                        achievements: taskData.achievements || '',
                        scopeOfImprovements: taskData.scopeOfImprovements || '',
                        toolsUsed: taskData.toolsUsed || [],
                        startTime: taskData.startTime,
                        endTime: taskData.endTime,
                        totalHours: formatDuration(duration),
                        percentageComplete: taskData.percentageComplete || 0,
                        pmsId: taskData.pmsId,
                        pmsSubtaskId: taskData.pmsSubtaskId,
                    },
                });
            }
        } else {
            // Create new task (always local initially in this app's logic)
            const newTask: Task = {
                id: `local-${Date.now()}`,
                project: taskData.project,
                title: taskData.title,
                subTask: taskData.subTask || '',
                description: taskData.description,
                problemAndIssues: taskData.problemAndIssues || '',
                quantify: taskData.quantify || '',
                achievements: taskData.achievements || '',
                scopeOfImprovements: taskData.scopeOfImprovements || '',
                toolsUsed: taskData.toolsUsed || [],
                startTime: taskData.startTime,
                endTime: taskData.endTime,
                percentageComplete: taskData.percentageComplete || 0,
                durationMinutes: duration,
                isComplete: false,
                pmsId: taskData.pmsId,
                pmsSubtaskId: taskData.pmsSubtaskId,
            };
            const stored = localStorage.getItem(storageKey);
            const tasks = stored ? JSON.parse(stored) : [];
            localStorage.setItem(storageKey, JSON.stringify([...tasks, newTask]));
            toast({ title: 'Task Added', description: 'Task added to your daily list.' });
            setLocation('/tracker');
        }
    };

    if (isLoadingTask) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-950">
                <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLocation('/tracker')}
                    className="text-blue-300 hover:text-white hover:bg-slate-800"
                >
                    <ChevronLeft className="w-6 h-6" />
                </Button>
                <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk' }}>
                    {id ? 'Edit Task' : 'Add New Task'}
                </h1>
            </div>

            <TaskForm
                task={editingTask ? {
                    id: editingTask.id,
                    project: editingTask.project,
                    title: editingTask.title,
                    // @ts-ignore
                    pmsId: (editingTask as any).pmsId,
                    subTask: editingTask.subTask || '',
                    description: editingTask.description,
                    problemAndIssues: (editingTask as any).problemAndIssues || '',
                    quantify: editingTask.quantify || '',
                    achievements: (editingTask as any).achievements || '',
                    scopeOfImprovements: (editingTask as any).scopeOfImprovements || '',
                    toolsUsed: editingTask.toolsUsed,
                    startTime: editingTask.startTime,
                    endTime: editingTask.endTime,
                    percentageComplete: editingTask.percentageComplete,
                    // @ts-ignore
                    pmsSubtaskId: editingTask.pmsSubtaskId,
                } : undefined}
                onSave={handleSaveTask}
                onCancel={() => setLocation('/tracker')}
                user={user ? { role: user.role, employeeCode: user.employeeCode } : undefined}
            />
        </div>
    );
}
