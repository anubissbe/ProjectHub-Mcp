import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { taskService } from '../services/taskService';
import { projectService } from '../services/projectService';
import { Task, Project } from '../types';
import { useStore } from '../store';
import { TaskFilters, TaskFilters as ITaskFilters } from '../components/TaskFilters';
import { TaskAnalytics } from '../components/TaskAnalytics';
import { BulkTaskActions } from '../components/BulkTaskActions';
import { PomodoroTimer } from '../components/PomodoroTimer';
import { TaskTemplates } from '../components/TaskTemplates';
import { TimeTrackingDashboard } from '../components/TimeTrackingDashboard';
import { CreateTaskModal } from '../components/CreateTaskModal';
import { EditTaskModal } from '../components/EditTaskModal';
import { PageBanner } from '../components/PageBanner';
import { SemanticTaskSearch } from '../components/SemanticTaskSearch';
import { McpStatusDashboard } from '../components/McpStatusDashboard';

const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'testing', 'completed', 'failed'];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 border-gray-300',
  in_progress: 'bg-orange-50 border-orange-300',
  blocked: 'bg-gray-900 border-gray-700',
  testing: 'bg-orange-100 border-orange-400',
  completed: 'bg-orange-200 border-orange-500',
  failed: 'bg-black border-gray-800',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-orange-600',
  high: 'bg-orange-500',
  medium: 'bg-orange-400',
  low: 'bg-gray-400',
};

export function Board() {
  const params = useParams<{ projectId?: string; id?: string }>();
  const projectIdFromUrl = params.projectId || params.id;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subtasks, setSubtasks] = useState<Record<string, Task[]>>({});
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ITaskFilters>({
    search: '',
    status: [],
    priority: [],
    assignedTo: '',
    hasSubtasks: null,
    estimatedHours: {},
    dateRange: {},
  });
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createTaskStatus, setCreateTaskStatus] = useState<string>('pending');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [activeTimers, setActiveTimers] = useState<Record<string, boolean>>({});
  const selectedProjectId = useStore((state) => state.selectedProjectId);
  const setSelectedProjectId = useStore((state) => state.setSelectedProjectId);

  const activeProjectId = projectIdFromUrl || selectedProjectId;

  const fetchProjects = async () => {
    try {
      const projectsData = await projectService.getAllProjects();
      setProjects(projectsData);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchProjectAndTasks = useCallback(async () => {
    if (!activeProjectId) return;
    
    setLoading(true);
    try {
      const [projectData, tasksData] = await Promise.all([
        projectService.getProjectById(activeProjectId),
        taskService.getTasksByProject(activeProjectId),
      ]);
      
      setProject(projectData);
      
      // Get all tasks including subtasks
      const allTasks: Task[] = [...tasksData];
      const subtasksMap: Record<string, Task[]> = {};
      
      // Fetch subtasks for all parent tasks
      const parentTasks = tasksData.filter(task => !task.parent_task_id);
      
      for (const parentTask of parentTasks) {
        try {
          const subs = await taskService.getSubtasks(parentTask.id);
          subtasksMap[parentTask.id] = subs;
          allTasks.push(...subs);
        } catch (error) {
          console.error(`Error fetching subtasks for ${parentTask.id}:`, error);
          subtasksMap[parentTask.id] = [];
        }
      }
      
      setTasks(allTasks);
      setSubtasks(subtasksMap);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      fetchProjectAndTasks();
    } else if (projects.length > 0 && !projectIdFromUrl) {
      // Auto-select first project if none selected
      setSelectedProjectId(projects[0].id);
    }
  }, [activeProjectId, projects, projectIdFromUrl, fetchProjectAndTasks, setSelectedProjectId]);

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      await taskService.updateTaskStatus(taskId, newStatus);
      await fetchProjectAndTasks();
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const toggleTaskExpansion = (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };

  // Filter tasks based on current filters
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const searchIn = [
          task.name,
          task.description,
          task.implementation_notes,
          task.assigned_to
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchIn.includes(searchLower)) return false;
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(task.status)) {
        return false;
      }

      // Priority filter
      if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) {
        return false;
      }

      // Assigned to filter
      if (filters.assignedTo && (!task.assigned_to || !task.assigned_to.toLowerCase().includes(filters.assignedTo.toLowerCase()))) {
        return false;
      }

      // Has subtasks filter
      if (filters.hasSubtasks !== null) {
        const hasSubtasks = subtasks[task.id]?.length > 0;
        if (filters.hasSubtasks !== hasSubtasks) return false;
      }

      // Estimated hours filter
      if (filters.estimatedHours.min !== undefined && (task.estimated_hours || 0) < filters.estimatedHours.min) {
        return false;
      }
      if (filters.estimatedHours.max !== undefined && (task.estimated_hours || 0) > filters.estimatedHours.max) {
        return false;
      }

      return true;
    });
  }, [tasks, filters, subtasks]);

  // Calculate task counts for filters
  const taskCounts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    
    filteredTasks.forEach(task => {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
    });

    return {
      total: filteredTasks.length,
      byStatus,
      byPriority,
    };
  }, [filteredTasks]);

  const getTasksByStatus = (status: string) => {
    // Only show parent tasks at the top level, filtered
    return filteredTasks.filter(task => task.status === status && !task.parent_task_id);
  };

  const TaskCard = ({ task, isSubtask = false }: { task: Task; isSubtask?: boolean }) => {
    const hasSubtasks = !isSubtask && subtasks[task.id]?.length > 0;
    const isExpanded = expandedTasks.has(task.id);
    const isSelected = selectedTasks.some(t => t.id === task.id);
    
    const toggleSelection = () => {
      if (isSelected) {
        setSelectedTasks(prev => prev.filter(t => t.id !== task.id));
      } else {
        setSelectedTasks(prev => [...prev, task]);
      }
    };
    
    return (
      <div 
        className={`bg-white dark:bg-gray-700 p-3 rounded-lg shadow-sm border transition-all cursor-pointer hover:shadow-md ${
          isSubtask ? 'ml-4 mt-2' : 'mb-2'
        } ${isSelected ? 'ring-2 ring-orange-500 border-orange-300' : 'border-gray-200 dark:border-gray-600'}`}
        onClick={(e) => {
          // Don't open edit modal if clicking on checkbox, button, or link
          if ((e.target as HTMLElement).closest('input, button, a, .pomodoro-timer')) {
            return;
          }
          setEditingTask(task);
        }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2 flex-1">
            {/* Selection checkbox */}
            {!isSubtask && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelection()}
                className="mt-1 h-4 w-4 text-orange-600 rounded border-gray-300 focus:ring-orange-500"
              />
            )}
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {hasSubtasks && (
                  <button
                    onClick={() => toggleTaskExpansion(task.id)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
                <h4 className="font-medium text-gray-900 dark:text-white">{task.name}</h4>
              </div>
              
              {task.description && (
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{task.description}</p>
              )}
              
              {task.assigned_to && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  👤 {task.assigned_to}
                </p>
              )}
              
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${PRIORITY_COLORS[task.priority || 'medium']}`}>
                  {task.priority || 'medium'}
                </span>
                {task.estimated_hours && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-600 px-2 py-0.5 rounded">
                    ⏱️ {task.estimated_hours}h
                  </span>
                )}
                {task.actual_hours && (
                  <span className="text-xs text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/20 px-2 py-0.5 rounded">
                    ✅ {task.actual_hours}h
                  </span>
                )}
                {hasSubtasks && (
                  <span className="text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/20 px-2 py-0.5 rounded">
                    📋 {subtasks[task.id]?.length || 0} subtasks
                  </span>
                )}
              </div>
              
              {task.implementation_notes && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                    📝 Implementation notes
                  </summary>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 pl-4 border-l-2 border-gray-200 dark:border-gray-600">
                    {task.implementation_notes}
                  </p>
                </details>
              )}
              
              {/* Pomodoro Timer - only for non-subtasks and when task is in progress */}
              {!isSubtask && (task.status === 'in_progress' || activeTimers[task.id]) && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 pomodoro-timer">
                  <PomodoroTimer
                    task={task}
                    onTimeUpdate={(taskId, timeSpent) => {
                      // Update the task in local state immediately for better UX
                      setTasks(prevTasks => 
                        prevTasks.map(t => 
                          t.id === taskId 
                            ? { ...t, actual_hours: (t.actual_hours || 0) + timeSpent }
                            : t
                        )
                      );
                    }}
                    onComplete={() => {
                      setActiveTimers(prev => ({ ...prev, [task.id]: false }));
                    }}
                  />
                </div>
              )}
              
              {/* Quick Timer Toggle for non-progress tasks */}
              {!isSubtask && task.status !== 'in_progress' && !activeTimers[task.id] && task.status !== 'completed' && (
                <div className="mt-2">
                  <button
                    onClick={() => setActiveTimers(prev => ({ ...prev, [task.id]: true }))}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors"
                  >
                    🍅 Start Timer
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {hasSubtasks && isExpanded && (
          <div className="mt-2">
            {subtasks[task.id].map((subtask) => (
              <TaskCard key={subtask.id} task={subtask} isSubtask={true} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (!activeProjectId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select a project to view the board.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Loading board...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="p-6">
        <PageBanner
          icon="📋"
          title={project?.name || 'Kanban Board'}
          subtitle={project?.description || 'Manage your tasks efficiently'}
          actionButton={
            <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCreateTaskStatus('pending');
                setShowCreateTask(true);
              }}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold shadow-lg shadow-orange-500/20"
            >
              ➕ New Task
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="px-4 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-semibold"
            >
              📋 Templates
            </button>
            <button
              onClick={() => setShowAnalytics(!showAnalytics)}
              className={`px-4 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                showAnalytics 
                  ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' 
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              📊 Analytics
            </button>
            <button
              onClick={() => {
                const allTaskIds = filteredTasks.filter(t => !t.parent_task_id).map(t => t.id);
                setExpandedTasks(new Set(allTaskIds));
              }}
              className="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Expand All
            </button>
            <button
              onClick={() => {
                if (selectedTasks.length === filteredTasks.filter(t => !t.parent_task_id).length) {
                  setSelectedTasks([]);
                } else {
                  setSelectedTasks(filteredTasks.filter(t => !t.parent_task_id));
                }
              }}
              className="px-4 py-2 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              {selectedTasks.length === filteredTasks.filter(t => !t.parent_task_id).length ? 'Deselect All' : 'Select All'}
            </button>
            </div>
          }
        />

        {/* Task Filters */}
        <TaskFilters
          onFiltersChange={setFilters}
          taskCounts={taskCounts}
        />

        {/* Semantic Search */}
        <div className="mb-6">
          <SemanticTaskSearch
            projects={projects}
            onTaskSelect={(taskId) => {
              const task = tasks.find(t => t.id === taskId);
              if (task) {
                setEditingTask(task);
              }
            }}
            placeholder="Search tasks with AI-powered semantic search..."
            className=""
          />
        </div>

        {/* MCP Status Dashboard */}
        <div className="mb-6">
          <McpStatusDashboard showDetails={false} />
        </div>

        {/* Analytics Panel */}
        {showAnalytics && project && (
          <div className="mb-6 space-y-6">
            <TaskAnalytics tasks={filteredTasks} project={project} />
            <TimeTrackingDashboard tasks={filteredTasks} />
          </div>
        )}
      </div>

      <div className="flex-1 p-6 pt-4">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {TASK_STATUSES.map((status) => {
            const statusTasks = getTasksByStatus(status);
            // Count all filtered tasks with this status (including subtasks)
            const allStatusTasks = filteredTasks.filter(t => t.status === status);
            const totalTasks = allStatusTasks.length;

            return (
              <div
                key={status}
                className={`min-w-[320px] flex-1 ${STATUS_COLORS[status]} dark:bg-gray-800 rounded-lg border-2 dark:border-gray-600 flex flex-col max-h-[calc(100vh-200px)]`}
              >
                <div className="flex items-center justify-between p-4 pb-3">
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300 capitalize">
                    {status.replace('_', ' ')}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'}
                    </span>
                    <button
                      onClick={() => {
                        setCreateTaskStatus(status);
                        setShowCreateTask(true);
                      }}
                      className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                      title={`Add task to ${status.replace('_', ' ')}`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  className="flex-1 overflow-y-auto p-4 pt-0 space-y-2"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('bg-blue-50', 'dark:bg-blue-900/20');
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-900/20');
                    const taskId = e.dataTransfer.getData('taskId');
                    if (taskId) {
                      updateTaskStatus(taskId, status);
                    }
                  }}
                >
                  {statusTasks.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      <div className="text-4xl mb-2">📋</div>
                      <p className="text-sm">No tasks in {status.replace('_', ' ')}</p>
                      <p className="text-xs mt-1">Drag tasks here or use bulk actions</p>
                    </div>
                  ) : (
                    statusTasks.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('taskId', task.id);
                          e.currentTarget.classList.add('opacity-50');
                        }}
                        onDragEnd={(e) => {
                          e.currentTarget.classList.remove('opacity-50');
                        }}
                        className="cursor-move transition-opacity"
                      >
                        <TaskCard task={task} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bulk Actions */}
      <BulkTaskActions
        selectedTasks={selectedTasks}
        onTasksUpdated={fetchProjectAndTasks}
        onSelectionCleared={() => setSelectedTasks([])}
      />

      {/* Task Templates Modal */}
      {showTemplates && activeProjectId && (
        <TaskTemplates
          projectId={activeProjectId}
          onTasksCreated={fetchProjectAndTasks}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* Create Task Modal */}
      {showCreateTask && activeProjectId && (
        <CreateTaskModal
          projectId={activeProjectId}
          defaultStatus={createTaskStatus}
          onClose={() => setShowCreateTask(false)}
          onTaskCreated={() => {
            fetchProjectAndTasks();
            setShowCreateTask(false);
          }}
        />
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onTaskUpdated={() => {
            fetchProjectAndTasks();
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}