import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Edit2, Trash2, Check, Clock, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface Task {
  id: string;
  pmsId?: string;
  pmsSubtaskId?: string;
  project: string;
  title: string;
  subTask?: string;
  description: string;
  problemAndIssues: string;
  quantify: string;
  achievements: string;
  scopeOfImprovements: string;
  toolsUsed: string[];
  startTime: string;
  endTime: string;
  durationMinutes: number;
  percentageComplete: number;
  isComplete: boolean;
  serverStatus?: 'draft' | 'pending' | 'manager_approved' | 'approved' | 'rejected';
}

interface TaskTableProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onComplete: (taskId: string) => void;
}

export default function TaskTable({ tasks, onEdit, onDelete, onComplete }: TaskTableProps) {
  const formatDuration = (minutes: number) => {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  if (tasks.length === 0) {
    return (
      <Card className="bg-slate-800/50 border-blue-500/20 p-8">
        <div className="text-center">
          <Clock className="w-12 h-12 text-blue-400/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">No tasks yet</h3>
          <p className="text-blue-200/60 text-sm">
            Click "Add Task" to start tracking your work
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/50 border-blue-500/20 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-blue-500/20 hover:bg-transparent">
              <TableHead className="text-blue-300">Project</TableHead>
              <TableHead className="text-blue-300">Title</TableHead>
              <TableHead className="text-blue-300">Status</TableHead>
              <TableHead className="text-blue-300">Time</TableHead>
              <TableHead className="text-blue-300">Duration</TableHead>
              <TableHead className="text-blue-300 hidden md:table-cell">Progress</TableHead>
              <TableHead className="text-blue-300 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow
                key={task.id}
                className="border-blue-500/10 hover:bg-slate-700/30"
                data-testid={`row-task-${task.id}`}
              >
                <TableCell className="font-medium text-white">
                  <div className="flex items-center gap-2">
                    {task.isComplete && (
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                    )}
                    {task.project}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-white font-medium">{task.title}</p>
                    {task.subTask && (
                      <p className="text-sm text-blue-300">{task.subTask}</p>
                    )}
                    {task.description && (
                      <p className="text-xs text-blue-200/50 truncate max-w-[200px]">
                        {task.description}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {task.serverStatus === 'draft' && (
                    <Badge className="bg-slate-600 text-slate-200">Draft</Badge>
                  )}
                  {task.serverStatus === 'pending' && (
                    <Badge className="bg-yellow-600 text-yellow-100">Pending</Badge>
                  )}
                  {task.serverStatus === 'manager_approved' && (
                    <Badge className="bg-blue-600 text-blue-100">Manager Approved</Badge>
                  )}
                  {task.serverStatus === 'approved' && (
                    <Badge className="bg-green-600 text-green-100">Approved</Badge>
                  )}
                  {task.serverStatus === 'rejected' && (
                    <Badge className="bg-red-600 text-red-100">Rejected</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    <span className="text-blue-200">{task.startTime}</span>
                    <span className="text-slate-500 mx-1">-</span>
                    <span className="text-blue-200">{task.endTime}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="bg-slate-700 text-white">
                    {formatDuration(task.durationMinutes)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 min-w-[100px]">
                    <Progress
                      value={task.percentageComplete}
                      className="h-2 bg-slate-700"
                    />
                    <span className="text-xs text-blue-200 w-8">
                      {task.percentageComplete}%
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {(task.serverStatus === 'draft' || task.serverStatus === 'pending') ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-slate-400 hover:text-white"
                          data-testid={`button-task-actions-${task.id}`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-slate-800 border-blue-500/20">
                        <DropdownMenuItem
                          onClick={() => onEdit(task)}
                          className="text-blue-200 focus:bg-slate-700 focus:text-white"
                          data-testid={`button-edit-${task.id}`}
                        >
                          <Edit2 className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {task.serverStatus === 'draft' && !task.isComplete && (
                          <DropdownMenuItem
                            onClick={() => onComplete(task.id)}
                            className="text-green-400 focus:bg-slate-700 focus:text-green-300"
                            data-testid={`button-complete-${task.id}`}
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Mark Complete
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => onDelete(task.id)}
                          className="text-red-400 focus:bg-slate-700 focus:text-red-300"
                          data-testid={`button-delete-${task.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-slate-500 text-xs">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
