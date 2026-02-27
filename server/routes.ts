import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db';
import { pmsPool } from './pmsSupabase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  insertOrganisationSchema,
  insertEmployeeSchema,
  insertTimeEntrySchema,
  insertDepartmentSchema,
  insertGroupSchema,
} from "@shared/schema";

// Store connected WebSocket clients for real-time updates
const clients: Set<WebSocket> = new Set();

function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Helper function to check if a project deadline has passed
function isProjectExpired(endDate: string | null): boolean {
  if (!endDate) return false;

  try {
    const projectEndDate = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    projectEndDate.setHours(0, 0, 0, 0);
    return projectEndDate < today;
  } catch (error) {
    console.error("Error parsing project end date:", endDate, error);
    return false;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  // Seed managers and default employees on startup
  await storage.seedManagers();
  await storage.seedDefaultEmployees();

  // ============ AUTH ROUTES ============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { employeeCode, password } = req.body;

      if (!employeeCode || !password) {
        return res.status(400).json({ error: "Employee code and password are required" });
      }

      const employee = await storage.validateEmployee(employeeCode, password);

      if (!employee) {
        return res.status(401).json({ error: "Invalid employee code or password" });
      }

      // Don't send password to client
      const { password: _, ...safeEmployee } = employee;
      res.json({ user: safeEmployee });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // ============ EMAIL TEST ROUTE ============
  app.get("/api/test/email-config", async (req, res) => {
    res.json({
      RESEND_API_KEY: process.env.RESEND_API_KEY ? "✓ Present" : "✗ Missing",
      FROM_EMAIL: process.env.FROM_EMAIL || "Not set",
      SENDER_EMAIL: process.env.SENDER_EMAIL || "Not set",
    });
  });

  // ============ ORGANISATION ROUTES ============
  app.get("/api/organisations", async (req, res) => {
    try {
      const orgs = await storage.getOrganisations();
      res.json(orgs);
    } catch (error) {
      console.error("Get organisations error:", error);
      res.status(500).json({ error: "Failed to fetch organisations" });
    }
  });

  app.post("/api/organisations", async (req, res) => {
    try {
      const result = insertOrganisationSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const org = await storage.createOrganisation(result.data);
      broadcast("organisation_created", org);
      res.status(201).json(org);
    } catch (error) {
      console.error("Create organisation error:", error);
      res.status(500).json({ error: "Failed to create organisation" });
    }
  });

  app.patch("/api/organisations/:id", async (req, res) => {
    try {
      const org = await storage.updateOrganisation(req.params.id, req.body);
      if (!org) {
        return res.status(404).json({ error: "Organisation not found" });
      }
      broadcast("organisation_updated", org);
      res.json(org);
    } catch (error) {
      console.error("Update organisation error:", error);
      res.status(500).json({ error: "Failed to update organisation" });
    }
  });

  app.delete("/api/organisations/:id", async (req, res) => {
    try {
      await storage.deleteOrganisation(req.params.id);
      broadcast("organisation_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete organisation error:", error);
      res.status(500).json({ error: "Failed to delete organisation" });
    }
  });

  // ============ DEPARTMENT ROUTES ============
  app.get("/api/departments", async (req, res) => {
    try {
      const depts = await storage.getDepartments();
      res.json(depts);
    } catch (error) {
      console.error("Get departments error:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  });

  app.post("/api/departments", async (req, res) => {
    try {
      const result = insertDepartmentSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const dept = await storage.createDepartment(result.data);
      broadcast("department_created", dept);
      res.status(201).json(dept);
    } catch (error) {
      console.error("Create department error:", error);
      res.status(500).json({ error: "Failed to create department" });
    }
  });

  app.patch("/api/departments/:id", async (req, res) => {
    try {
      const dept = await storage.updateDepartment(req.params.id, req.body);
      if (!dept) {
        return res.status(404).json({ error: "Department not found" });
      }
      broadcast("department_updated", dept);
      res.json(dept);
    } catch (error) {
      console.error("Update department error:", error);
      res.status(500).json({ error: "Failed to update department" });
    }
  });

  app.delete("/api/departments/:id", async (req, res) => {
    try {
      await storage.deleteDepartment(req.params.id);
      broadcast("department_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete department error:", error);
      res.status(500).json({ error: "Failed to delete department" });
    }
  });

  // ============ GROUP ROUTES ============
  app.get("/api/groups", async (req, res) => {
    try {
      const grps = await storage.getGroups();
      res.json(grps);
    } catch (error) {
      console.error("Get groups error:", error);
      res.status(500).json({ error: "Failed to fetch groups" });
    }
  });

  app.post("/api/groups", async (req, res) => {
    try {
      const result = insertGroupSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      const group = await storage.createGroup(result.data);
      broadcast("group_created", group);
      res.status(201).json(group);
    } catch (error) {
      console.error("Create group error:", error);
      res.status(500).json({ error: "Failed to create group" });
    }
  });

  app.patch("/api/groups/:id", async (req, res) => {
    try {
      const group = await storage.updateGroup(req.params.id, req.body);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }
      broadcast("group_updated", group);
      res.json(group);
    } catch (error) {
      console.error("Update group error:", error);
      res.status(500).json({ error: "Failed to update group" });
    }
  });

  app.delete("/api/groups/:id", async (req, res) => {
    try {
      await storage.deleteGroup(req.params.id);
      broadcast("group_deleted", { id: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete group error:", error);
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // ============ EMPLOYEE ROUTES ============
  app.get("/api/employees", async (req, res) => {
    try {
      const emps = await storage.getEmployees();
      // Remove passwords from response
      const safeEmps = emps.map(({ password, ...emp }) => emp);
      res.json(safeEmps);
    } catch (error) {
      console.error("Get employees error:", error);
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const result = insertEmployeeSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error.errors });
      }

      // Check if employee code already exists
      const existing = await storage.getEmployeeByCode(result.data.employeeCode);
      if (existing) {
        return res.status(400).json({ error: "Employee code already exists" });
      }

      const emp = await storage.createEmployee(result.data);
      const { password, ...safeEmp } = emp;
      broadcast("employee_created", safeEmp);
      res.status(201).json(safeEmp);
    } catch (error) {
      console.error("Create employee error:", error);
      res.status(500).json({ error: "Failed to create employee" });
    }
  });

  // ============ MANAGER ROUTES ============
  app.get("/api/managers", async (req, res) => {
    try {
      const mgrs = await storage.getManagers();
      res.json(mgrs);
    } catch (error) {
      console.error("Get managers error:", error);
      res.status(500).json({ error: "Failed to fetch managers" });
    }
  });

  // ============ PROJECTS ROUTES ============
  app.get("/api/projects", async (req, res) => {
    try {
      const { userRole, userEmpCode, userDepartment } = req.query;
      const projects = await storage.getProjects(userRole as string, userEmpCode as string, userDepartment as string);
      res.json(projects);
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const project = await storage.createProject(req.body);
      broadcast("project_created", project);
      res.status(201).json(project);
    } catch (error) {
      console.error("Create project error:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // ============ TASKS ROUTES ============
  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId, userDepartment } = req.query;
      const tasks = await storage.getTasks(projectId as string, userDepartment as string);
      res.json(tasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const task = await storage.createTask(req.body);
      broadcast("task_created", task);
      res.status(201).json(task);
    } catch (error) {
      console.error("Create task error:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  // ============ SUBTASKS ROUTES ============
  app.get("/api/subtasks", async (req, res) => {
    try {
      const { taskId, userDepartment } = req.query;

      // Get PMS subtasks
      const pmsSubtasks = await storage.getPMSSubtasks(taskId as string, userDepartment as string);

      // For now, only return PMS subtasks since local subtasks table may not exist
      res.json(pmsSubtasks);
    } catch (error) {
      console.error("Get subtasks error:", error);
      res.status(500).json({ error: "Failed to fetch subtasks" });
    }
  });

  app.post("/api/subtasks", async (req, res) => {
    try {
      const subtask = await storage.createSubtask(req.body);
      broadcast("subtask_created", subtask);
      res.status(201).json(subtask);
    } catch (error) {
      console.error("Create subtask error:", error);
      res.status(500).json({ error: "Failed to create subtask" });
    }
  });

  // ============ KEY STEPS ROUTE (PMS) ============
  app.get('/api/key-steps', async (req, res) => {
    try {
      const { projectId } = req.query;
      if (!projectId) return res.json([]);

      // Query PMS DB for key steps tied to the project code
      const query = `
        SELECT ks.id, ks.title AS name
        FROM key_steps ks
        INNER JOIN projects p ON ks.project_id = p.id
        WHERE p.project_code = $1
        ORDER BY ks.title
      `;
      const result = await pmsPool.query(query, [projectId]);
      const rows = result && result.rows ? result.rows : [];
      res.json(rows);
    } catch (error) {
      console.error('Get key steps error:', error);
      res.status(500).json([]);
    }
  });

  // ============ TIME ENTRY ROUTES ============
  app.get("/api/time-entries", async (req, res) => {
    try {
      const entries = await storage.getTimeEntries();
      res.json(entries);
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  app.get("/api/time-entries/pending", async (req, res) => {
    try {
      const entries = await storage.getPendingTimeEntries();
      res.json(entries);
    } catch (error) {
      console.error("Get pending entries error:", error);
      res.status(500).json({ error: "Failed to fetch pending entries" });
    }
  });

  app.get("/api/time-entries/employee/:employeeId", async (req, res) => {
    try {
      const entries = await storage.getTimeEntriesByEmployee(req.params.employeeId);
      res.json(entries);
    } catch (error) {
      console.error("Get employee entries error:", error);
      res.status(500).json({ error: "Failed to fetch employee entries" });
    }
  });

  app.post("/api/time-entries", async (req, res) => {
    try {
      // Manual field extraction to ensure all data is captured
      const entryData = {
        ...req.body,
        employeeId: req.body.employeeId,
        employeeCode: req.body.employeeCode,
        employeeName: req.body.employeeName,
        date: req.body.date,
        projectName: req.body.projectName,
        taskDescription: req.body.taskDescription,
        problemAndIssues: req.body.problemAndIssues || null,
        quantify: req.body.quantify || "",
        achievements: req.body.achievements || null,
        scopeOfImprovements: req.body.scopeOfImprovements || null,
        toolsUsed: req.body.toolsUsed || [],
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        totalHours: req.body.totalHours,
        percentageComplete: parseInt(req.body.percentageComplete) || 0,
        pmsId: req.body.pmsId || null,
        pmsSubtaskId: req.body.pmsSubtaskId || null,
      };

      const result = insertTimeEntrySchema.safeParse(entryData);
      if (!result.success) {
        console.error("[TIME-ENTRY] Validation error:", result.error);
        return res.status(400).json({ error: result.error });
      }

      const entry = await storage.createTimeEntry(result.data);

      // Handle PMS Status Synchronization
      try {
        console.log(`[PMS-SYNC] Starting sync. pmsId: ${req.body.pmsId}, pmsSubtaskId: ${req.body.pmsSubtaskId}`);
        const { updateSubtaskInPMS, checkAndMarkTaskCompleted, updateTaskInPMS } = await import('./pmsSupabase');

        // CASE 1: Subtask completion
        if (req.body.pmsSubtaskId) {
          console.log(`[PMS-SYNC] Attempting to mark subtask ${req.body.pmsSubtaskId} as completed`);
          const subtaskResult = await updateSubtaskInPMS(req.body.pmsSubtaskId, true);
          console.log(`[PMS-SYNC] Subtask update result:`, subtaskResult ? 'SUCCESS' : 'FAILED');

          if (req.body.pmsId) {
            console.log(`[PMS-SYNC] Checking parent task ${req.body.pmsId} for completion`);
            await checkAndMarkTaskCompleted(req.body.pmsId);
          }
        }
        // CASE 2: No subtask - mark task itself as completed on submission
        else if (req.body.pmsId) {
          console.log(`[PMS-SYNC] Marking task ${req.body.pmsId} as completed (no subtask)`);
          const taskResult = await updateTaskInPMS(req.body.pmsId, { status: 'Completed' });
          console.log(`[PMS-SYNC] Task update result:`, taskResult ? 'SUCCESS' : 'FAILED');
        } else {
          console.log(`[PMS-SYNC] No pmsId or pmsSubtaskId provided. Skipping sync.`);
        }
      } catch (pmsSyncError) {
        console.error("[PMS-SYNC] Error during status synchronization:", pmsSyncError);
        // We don't fail the request if PMS sync fails, but we log it
      }

      broadcast("time_entry_created", entry);

      // ============ PMS SYNC ============
      // If this entry is linked to a PMS task, update progress/status in PMS
      if (entry.pmsId && entry.percentageComplete !== null) {
        try {
          const { updateProjectProgress, updateTaskInPMS, getProjects } = await import('./pmsSupabase');

          console.log(`🔄 Syncing PMS for task ${entry.pmsId}, progress: ${entry.percentageComplete}%`);

          // 1. Update Task Status if 100%
          if (entry.percentageComplete === 100) {
            await updateTaskInPMS(entry.pmsId, { status: 'Completed', end_date: entry.date });
            console.log(`✅ PMS Task ${entry.pmsId} marked as Completed`);
          }

          // 2. Update Project Progress
          // We need to find the project first to get its ID/Code. 
          // storage.createTimeEntry saves `projectName`. We'll try to match it.
          // Note: This matches by name. Ideally we'd store project_code in time_entries too, 
          // but for now relying on name match or if we had pmsProjectId.
          // Let's try to fetch project by name if we can, or just update if we have the code.
          // Since we don't have project_code in entry, we search.

          // Optimization: If the frontend passed pmsProjectId (not in schema yet), we could use it.
          // For now, let's look up the project by name.
          // We can reuse getProjects but that might be heavy. 
          // Let's just try to update by matching title in the update query (updateProjectProgress supports project_code or id, let's assume valid UUID or Code).
          // Actually updateProjectProgress query is: WHERE id::text = $2 OR project_code = $2
          // Using projectName there won't work if it's a name.

          // Let's resolve project_code from name
          const pmsProjects = await getProjects();
          const matchedProject = pmsProjects.find(p => p.project_name === entry.projectName);

          if (matchedProject) {
            await updateProjectProgress(matchedProject.id, entry.percentageComplete);
            console.log(`✅ PMS Project ${matchedProject.project_name} progress updated to ${entry.percentageComplete}%`);
          } else {
            console.warn(`⚠️ Could not find PMS project matching "${entry.projectName}" to update progress.`);
          }

        } catch (pmsError) {
          console.error("❌ Failed to sync with PMS:", pmsError);
          // Don't fail the request, just log
        }
      }
      // ==================================

      // NOTE: Email notifications are now sent per day (not per task) via /api/time-entries/submit-daily
      // This prevents multiple emails for multiple tasks submitted on the same day
      console.log('[EMAIL] Task created - email will be sent with daily digest endpoint');

      res.status(201).json(entry);
    } catch (error) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // Update a time entry (only if pending)
  app.put("/api/time-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.getTimeEntry(id);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      if (entry.status !== 'pending') {
        return res.status(400).json({ error: "Cannot edit entry that is not pending" });
      }

      const updatedEntry = await storage.updateTimeEntry(id, req.body);
      broadcast("time_entry_updated", updatedEntry);
      res.json(updatedEntry);
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ error: "Failed to update time entry" });
    }
  });

  // Delete a time entry (only if pending)
  app.delete("/api/time-entries/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const entry = await storage.getTimeEntry(id);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      if (entry.status !== 'pending') {
        return res.status(400).json({ error: "Cannot delete entry that is not pending" });
      }

      await storage.deleteTimeEntry(id);
      broadcast("time_entry_deleted", { id });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Failed to delete time entry" });
    }
  });

  // Submit daily tasks summary email
  app.post("/api/time-entries/submit-daily/:employeeId/:date", async (req, res) => {
    try {
      const { employeeId, date } = req.params;

      // fetch every entry for the user on the requested date
      const dailyEntries = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      if (dailyEntries.length === 0) {
        return res.status(404).json({ error: "No tasks found for this date" });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      const totalHours = dailyEntries.reduce((sum, entry) => {
        const hours = parseFloat(entry.totalHours);
        return sum + (isNaN(hours) ? 0 : hours);
      }, 0);

      // use the raw entries as tasks so the email helper has full data
      const tasks = dailyEntries;
      const { sendTimesheetSummaryEmail } = await import('./email');
      const emailResult = await sendTimesheetSummaryEmail({
        employeeId: employee.id,
        employeeName: employee.name,
        employeeCode: employee.employeeCode,
        date,
        totalHours: totalHours.toFixed(2),
        tasks,
        status: 'pending',
      });

      if (!emailResult.success) {
        return res.status(500).json({
          error: "Failed to send daily summary email",
          details: emailResult.error,
        });
      }

      console.log(`[DAILY SUBMIT] Daily summary sent for ${employee.name} on ${date}`);
      res.json({
        success: true,
        message: `Daily summary email sent for ${date} with ${dailyEntries.length} tasks`,
        taskCount: dailyEntries.length,
        totalHours: totalHours.toFixed(2),
        emailId: emailResult.result?.id,
      });
    } catch (error) {
      console.error("Submit daily summary error:", error);
      res.status(500).json({ error: "Failed to submit daily summary" });
    }
  });

  // Manager approval (first stage of dual approval)
  app.patch("/api/time-entries/:id/manager-approve", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.managerApproveTimeEntry(req.params.id, approvedBy);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // if every task for that day has been manager_approved, send one summary to employee
      const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, entry.date);
      const allHRApproved = allTasks.every(t => t.status === 'manager_approved');
      if (allHRApproved) {
        const employee = await storage.getEmployee(entry.employeeId);
        const approver = await storage.getEmployee(approvedBy);
        try {
          const { sendApprovalSummaryEmail } = await import('./email');
          await sendApprovalSummaryEmail({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            employeeCode: entry.employeeCode,
            date: entry.date,
            tasks: allTasks,
            status: 'manager_approved',
            recipients: employee?.email ? [employee.email] : undefined,
            approverName: approver?.name,
          });
        } catch (emailError) {
          console.error('[EMAIL] Failed to send grouped HR approval email:', emailError);
        }
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);
    } catch (error) {
      console.error("Manager approve entry error:", error);
      res.status(500).json({ error: "Failed to approve entry" });
    }
  });

  // Admin approval (final stage of dual approval)
  app.patch("/api/time-entries/:id/approve", async (req, res) => {
    try {
      const { approvedBy } = req.body;
      const entry = await storage.adminApproveTimeEntry(req.params.id, approvedBy);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // check if full day is now finally approved
      const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, entry.date);
      const allApproved = allTasks.every(t => t.status === 'approved');
      if (allApproved) {
        const employee = await storage.getEmployee(entry.employeeId);
        const approver = await storage.getEmployee(approvedBy);
        try {
          const { sendApprovalSummaryEmail } = await import('./email');
          // build recipient list: default + employee
          const defaultRecipients = (process.env.SENDER_EMAIL || "").split(",").map(e => e.trim()).filter(Boolean);
          const recipients = employee?.email ? [...defaultRecipients, employee.email] : defaultRecipients;
          await sendApprovalSummaryEmail({
            employeeId: entry.employeeId,
            employeeName: entry.employeeName,
            employeeCode: entry.employeeCode,
            date: entry.date,
            tasks: allTasks,
            status: 'approved',
            recipients,
            approverName: approver?.name,
          });
        } catch (emailError) {
          console.error('[EMAIL] Failed to send grouped final approval email:', emailError);
        }
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);
    } catch (error) {
      console.error("Approve entry error:", error);
      res.status(500).json({ error: "Failed to approve entry" });
    }
  });

  app.patch("/api/time-entries/:id/reject", async (req, res) => {
    try {
      const { approvedBy, reason } = req.body;
      const entry = await storage.updateTimeEntryStatus(req.params.id, "rejected", approvedBy, reason);

      if (!entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // after updating, collect all rejected tasks for the same date
      const allTasks = await storage.getTimeEntriesByEmployeeAndDate(entry.employeeId, entry.date);
      const rejectedTasks = allTasks.filter(t => t.status === 'rejected');

      const employee = await storage.getEmployee(entry.employeeId);
      const approver = await storage.getEmployee(approvedBy);

      try {
        const { sendApprovalSummaryEmail } = await import('./email');
        await sendApprovalSummaryEmail({
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          employeeCode: entry.employeeCode,
          date: entry.date,
          tasks: rejectedTasks,
          status: 'rejected',
          recipients: employee?.email ? [employee.email] : undefined,
          approverName: approver?.name,
          rejectionReason: reason,
        });
      } catch (emailError) {
        console.error('[EMAIL] Failed to send grouped rejection email:', emailError);
      }

      broadcast("time_entry_updated", entry);
      res.json(entry);
    } catch (error) {
      console.error("Reject entry error:", error);
      res.status(500).json({ error: "Failed to reject entry" });
    }
  });

  // ============ NOTIFICATION ROUTES ============
  app.post("/api/notifications/timesheet-submitted", async (req, res) => {
    try {
      const { employeeId, employeeName, employeeCode, date } = req.body;

      console.log(`[NOTIFICATION] grouping submission for ${employeeName} (${employeeCode}) on ${date}`);

      const allTasks = await storage.getTimeEntriesByEmployeeAndDate(employeeId, date);
      console.log(`[NOTIFICATION] fetched ${allTasks.length} tasks from database`);
      if (allTasks.length === 0) {
        console.warn(`[NOTIFICATION] no tasks found for ${employeeId} on ${date}`);
        return res.status(404).json({ error: "No tasks found for that date" });
      }

      const totalHours = allTasks.reduce((acc, t) => acc + parseFloat(t.totalHours || "0"), 0).toFixed(2);

      try {
        const { sendTimesheetSummaryEmail } = await import('./email');
        const emailResult = await sendTimesheetSummaryEmail({
          employeeId,
          employeeName,
          employeeCode,
          date,
          totalHours,
          tasks: allTasks,
          status: 'pending',
        });
        console.log('[EMAIL] Grouped submission email sent, result:', emailResult);
      } catch (emailError) {
        console.error('[EMAIL] Failed to send grouped summary:', emailError);
      }

      // notify front end if needed
      broadcast("timesheet_submitted", { employeeName, employeeCode, date, totalHours });

      res.json({ success: true, taskCount: allTasks.length, totalHours });
    } catch (error) {
      console.error("Notification error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  // ============ PMS INTEGRATION ROUTES ============
  // Settings storage for timesheet blocking policy
  const SETTINGS_PATH = path.join(__dirname, '..', 'server-settings.json');

  async function readSettings() {
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
      return JSON.parse(raw || '{}');
    } catch (e) {
      return { blockUnassignedProjectTasks: false };
    }
  }

  async function writeSettings(s: any) {
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('Failed to write settings', e);
      return false;
    }
  }
  app.get("/api/projects", async (req, res) => {
    try {
      const { userRole, userEmpCode, userDepartment } = req.query;
      const { getProjects } = await import('./pmsSupabase');
      const pmsProjects = await getProjects(userRole as string, userEmpCode as string, userDepartment as string);

      // Add isExpired flag to each project
      const projectsWithExpiry = pmsProjects.map(p => ({
        ...p,
        isExpired: isProjectExpired(p.end_date || null),
      }));

      res.json(projectsWithExpiry);
    } catch (error) {
      console.error("PMS projects error:", error);
      res.status(500).json({ error: "Failed to fetch PMS projects" });
    }
  });

  app.get("/api/tasks", async (req, res) => {
    try {
      const { projectId, userDepartment } = req.query;
      const { getTasks } = await import('./pmsSupabase');
      const tasks = await getTasks(projectId as string, userDepartment as string);
      res.json(tasks);
    } catch (error) {
      console.error("PMS tasks error:", error);
      res.status(500).json({ error: "Failed to fetch PMS tasks" });
    }
  });

  // Return pending tasks assigned to employee that are due on given date and not completed
  app.get('/api/pending-deadline-tasks', async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string;
      const dateStr = req.query.date as string; // yyyy-mm-dd
      if (!employeeId || !dateStr) return res.status(400).json({ error: 'employeeId and date are required' });

      const employee = await storage.getEmployee(employeeId);
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      const userDept = employee.department || '';
      const { getProjects, getTasks, updateTaskInPMS } = await import('./pmsSupabase');
      const projects = await getProjects(employee.role, employee.employeeCode, userDept);

      const pending: any[] = [];
      const target = new Date(dateStr);

      // Normalize date to local yyyy-mm-dd key to avoid timezone shifts
      const formatDateLocal = (d: Date) => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };

      const targetKey = formatDateLocal(target);

      const settings = await readSettings();
      const includeProjectTasks = !!settings.blockUnassignedProjectTasks;

      for (const project of projects) {
        const tasks = await getTasks(project.project_code, userDept);
        for (const t of tasks) {
          // determine assignee match
          const assignedTo = (t.assignee || (t as any).assigned_to || '').toString();
          const members = Array.isArray((t as any).task_members) ? (t as any).task_members : [];
          const isAssigned = assignedTo === employee.employeeCode || members.includes(employee.employeeCode) || false;

          const taskDeadline = t.end_date ? new Date(t.end_date) : null;
          const taskKey = taskDeadline ? formatDateLocal(taskDeadline) : null;

          const notCompleted = !((t as any).is_completed || (t.status && t.status.toLowerCase() === 'completed'));

          // Diagnostic logging: why a task is included/excluded
          try {
            const debugInfo: any = {
              taskId: t.id,
              taskName: (t as any).task_name || (t as any).name || null,
              assignedTo: assignedTo || null,
              members: members || null,
              taskKey,
              targetKey,
              notCompleted,
              isAssignedMatch: isAssigned || false,
            };
            console.log('[PENDING-CHECK] task debug:', JSON.stringify(debugInfo));
          } catch (e) {
            // ignore logging errors
          }

          // Include task as pending if its deadline matches target and it's not completed.
          // Previously we filtered by assignment/settings; to ensure users cannot submit when any
          // task is due today, ignore those criteria here.
          const shouldInclude = taskKey && taskKey === targetKey && notCompleted;
          if (shouldInclude) {
            pending.push({
              ...t,
              projectCode: project.project_code,
              projectName: project.project_name,
              projectDeadline: project.end_date || null,
              // expose whether the task was explicitly assigned to employee
              isAssignedToEmployee: isAssigned || false,
            });
            console.log('[PENDING-CHECK] Included task:', t.id, (t as any).task_name || '');
          } else {
            // log exclusion reason lightly
            if (taskKey && taskKey === targetKey && !notCompleted) {
              console.log('[PENDING-CHECK] Excluded (already completed):', t.id);
            } else if (!taskKey) {
              console.log('[PENDING-CHECK] Excluded (no deadline):', t.id);
            } else if (taskKey !== targetKey) {
              console.log('[PENDING-CHECK] Excluded (date mismatch):', t.id, 'taskKey=', taskKey, 'targetKey=', targetKey);
            } else {
              console.log('[PENDING-CHECK] Excluded (other):', t.id);
            }
          }
        }
      }

      res.json(pending);
    } catch (error) {
      console.error('Pending deadline tasks error:', error);
      res.status(500).json({ error: 'Failed to compute pending tasks', details: String(error) });
    }
  });

  // Postpone a task: record postponement in local DB and update PMS
  app.post('/api/tasks/:id/postpone', async (req, res) => {
    try {
      const taskId = req.params.id;
      const { previousDueDate, newDueDate, reason, postponedBy, taskName } = req.body;
      if (!newDueDate || !reason) return res.status(400).json({ error: 'newDueDate and reason are required' });

      // Use raw DB via storage
      // ensure table exists (best-effort)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_postponements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            task_name text,
            previous_due_date text,
            new_due_date text NOT NULL,
            reason text NOT NULL,
            postponed_by varchar,
            postponed_at timestamp default now(),
            postpone_count integer default 1
          )`);
      } catch (e) {
        // ignore
      }

      // determine previous postpone count for this task
      const countRes = await pool.query(`SELECT COUNT(*)::int as cnt FROM task_postponements WHERE task_id = $1`, [taskId]);
      const previousCount = countRes.rows && countRes.rows[0] ? parseInt(countRes.rows[0].cnt, 10) : 0;
      const newCount = previousCount + 1;

      // insert postponement record with incremented count
      const insertRes = await pool.query(
        `INSERT INTO task_postponements (task_id, task_name, previous_due_date, new_due_date, reason, postponed_by, postpone_count) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [taskId, taskName || null, previousDueDate || null, newDueDate, reason, postponedBy || null, newCount]
      );
      const dbRes = insertRes.rows && insertRes.rows[0] ? insertRes.rows[0] : null;

      // update PMS task
      const { updateTaskInPMS } = await import('./pmsSupabase');
      const updated = await updateTaskInPMS(taskId, { end_date: newDueDate });

      // Notify HR and Admin
      try {
        // Get project details to find organization, but generic HR/Admin notification is acceptable as per request
        // We'll Notify all admins and HRs
        // In a real app we might filter by project's organization, but for now we broadcast to role
        const employees = await storage.getEmployees();
        const notifyList = employees.filter(e => e.role === 'admin' || e.role === 'hr' || e.department === 'HR & Admin');
        const recipientEmails = notifyList.map(e => e.email).filter(Boolean) as string[];

        // Also notify the employee who postponed (confirmation)
        if (postponedBy) {
          const actor = await storage.getEmployee(postponedBy);
          if (actor?.email) recipientEmails.push(actor.email);
        }

        const uniqueRecipients = Array.from(new Set(recipientEmails));

        if (uniqueRecipients.length > 0) {
          // Send email directly using the internal helper or just log if not available
          // Since this is server-side, we should use the email module, not apiRequest (which is client-side)
          try {
            // We can't use apiRequest here. It's likely a mistake in the previous code copy-paste.
            // We should import sendEmail from ./email or similar if available.
            // For now, let's just log it as the email implementation seems to be imported dynamically elsewhere.
            const { sendEmail } = await import('./email');
            await sendEmail({
              to: uniqueRecipients,
              subject: `Task Deadline Extended: Task ${taskId}`,
              html: `
                 <h3>Task Deadline Extended</h3>
                 <p><strong>Task:</strong> ${taskName || taskId}</p>
                 <p><strong>Postponed By:</strong> ${postponedBy}</p>
                 <p><strong>Reason:</strong> ${reason}</p>
                 <p><strong>New Due Date:</strong> ${newDueDate}</p>
                 <p><strong>Previous Due Date:</strong> ${previousDueDate || 'N/A'}</p>
               `
            });
          } catch (e) {
            console.error("Failed to send extension email:", e);
          }
          console.log(`[EMAIL] Postponement notification sent to ${uniqueRecipients.length} recipients`);
        }
      } catch (notifyErr) {
        console.error('[EMAIL] Failed to send postponement notification:', notifyErr);
      }

      res.json({ success: true, postponement: dbRes, updatedPMS: updated });
    } catch (error) {
      console.error('Postpone task error:', error);
      res.status(500).json({ error: 'Failed to postpone task', details: String(error) });
    }
  });

  // Acknowledge task deadline without extending
  app.post('/api/tasks/:id/acknowledge', async (req, res) => {
    try {
      const taskId = req.params.id;
      const { acknowledgedBy, projectCode } = req.body;

      if (!acknowledgedBy) return res.status(400).json({ error: 'acknowledgedBy is required' });

      // ensure table exists
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_deadline_acknowledgements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            acknowledged_by varchar NOT NULL,
            acknowledged_at timestamp default now(),
            project_code text
          )`);
      } catch (e) {
        // ignore
      }

      const result = await pool.query(
        `INSERT INTO task_deadline_acknowledgements (task_id, acknowledged_by, project_code) VALUES ($1, $2, $3) RETURNING *`,
        [taskId, acknowledgedBy, projectCode || null]
      );

      res.json({ success: true, acknowledgement: result.rows[0] });
    } catch (error) {
      console.error('Acknowledge task error:', error);
      res.status(500).json({ error: 'Failed to acknowledge task', details: String(error) });
    }
  });

  // Get all postponement history for Admin
  app.get('/api/admin/postponements', async (req, res) => {
    try {
      console.log(`[ADMIN-POSTPONEMENTS] Received request for history`);
      const postponements = await storage.getAllTaskPostponements();
      console.log(`[ADMIN-POSTPONEMENTS] Found ${postponements.length} records`);

      if (postponements.length > 0) {
        console.log(`[ADMIN-POSTPONEMENTS] Sample:`, JSON.stringify(postponements[0]).substring(0, 100));
      } else {
        // Run a manual check if empty
        const manualCheck = await pool.query('SELECT COUNT(*) FROM task_postponements');
        console.log(`[ADMIN-POSTPONEMENTS] Manual count check: ${manualCheck.rows[0].count}`);
      }

      res.json(postponements);
    } catch (error) {
      console.error('Get admin postponements error:', error);
      res.status(500).json({ error: 'Failed to fetch postponements' });
    }
  });

  app.get('/api/tasks/:id/postponements', async (req, res) => {
    try {
      const taskId = req.params.id;
      // ensure table exists (best-effort)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS task_postponements (
            id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id varchar NOT NULL,
            previous_due_date text,
            new_due_date text NOT NULL,
            reason text NOT NULL,
            postponed_by varchar,
            postponed_at timestamp default now(),
            postpone_count integer default 1
          )`);
      } catch (e) {
        // ignore
      }

      const q = await pool.query(`SELECT id, task_id as "taskId", previous_due_date as "previousDueDate", new_due_date as "newDueDate", reason, postponed_by as "postponedBy", postponed_at as "postponedAt", postpone_count as "postponeCount" FROM task_postponements WHERE task_id = $1 ORDER BY postponed_at DESC`, [taskId]);
      res.json(Array.isArray(q.rows) ? q.rows : []);
    } catch (error) {
      console.error('Get postponements error:', error);
      res.status(500).json({ error: 'Failed to fetch postponements', details: String(error) });
    }
  });

  app.get("/api/subtasks", async (req, res) => {
    try {
      const { taskId, userDepartment } = req.query;
      const { getSubtasks } = await import('./pmsSupabase');
      const subtasks = await getSubtasks(taskId as string, userDepartment as string);
      res.json(subtasks);
    } catch (error) {
      console.error("PMS subtasks error:", error);
      res.status(500).json({ error: "Failed to fetch PMS subtasks" });
    }
  });

  // Get available PMS tasks grouped by project for the employee's department
  app.get("/api/available-tasks", async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string;

      console.log("[AVAILABLE-TASKS] Request received for employee:", employeeId);

      if (!employeeId) {
        return res.status(400).json({ error: "Employee ID is required" });
      }

      // Get employee info to get department
      const employee = await storage.getEmployee(employeeId);
      if (!employee) {
        console.log("[AVAILABLE-TASKS] Employee not found:", employeeId);
        return res.status(404).json({ error: "Employee not found" });
      }

      console.log("[AVAILABLE-TASKS] Employee found:", { id: employee.id, department: employee.department, role: employee.role });

      const userDepartment = employee.department || '';

      // Get projects for this employee's department
      const { getProjects } = await import('./pmsSupabase');
      const projects = await getProjects(employee.role, employee.employeeCode, userDepartment);
      console.log("[AVAILABLE-TASKS] Projects retrieved:", projects.length);

      // Fetch tasks for each project and group them
      const { getTasks } = await import('./pmsSupabase');
      const tasksWithProjects: any[] = [];

      // Use local date key to avoid timezone issues when comparing deadlines
      const formatDateLocal = (d: Date) => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };
      const todayKey = formatDateLocal(new Date());

      for (const project of projects) {
        console.log("[AVAILABLE-TASKS] Fetching tasks for project:", project.project_code);
        const projectTasks = await getTasks(project.project_code, userDepartment);
        console.log("[AVAILABLE-TASKS] Total tasks retrieved for project:", projectTasks.length);

        // Filter out completed tasks
        const activeTasks = projectTasks.filter((task: any) => task.status !== 'Completed');
        console.log("[AVAILABLE-TASKS] Active tasks for project:", activeTasks.length);
        if (activeTasks.length === 0) {
          console.log("[AVAILABLE-TASKS] All tasks for this project are completed.");
        }

        tasksWithProjects.push(...activeTasks.map((task: any) => {
          // Check if project deadline has passed
          const projectDeadline = project.end_date ? new Date(project.end_date) : null;
          const projectKey = projectDeadline ? formatDateLocal(projectDeadline) : null;
          const isProjectOverdue = projectKey ? projectKey < todayKey : false;

          // Check if task deadline has passed
          const taskDeadline = task.end_date ? new Date(task.end_date) : null;
          const taskKey = taskDeadline ? formatDateLocal(taskDeadline) : null;
          const isTaskOverdue = taskKey ? taskKey < todayKey : false;

          return {
            ...task,
            projectCode: project.project_code,
            projectName: project.project_name,
            projectDescription: project.description,
            projectDeadline: project.end_date || null,
            taskDeadline: task.end_date || null,
            isProjectOverdue: isProjectOverdue || false,
            isTaskOverdue: isTaskOverdue || false,
            isOverdue: (isTaskOverdue || isProjectOverdue) ? true : false,
          };
        }));
      }

      console.log("[AVAILABLE-TASKS] Total tasks to return:", tasksWithProjects.length);
      res.json(tasksWithProjects);
    } catch (error) {
      console.error("[AVAILABLE-TASKS] Error:", error);
      res.status(500).json({ error: "Failed to fetch available tasks", details: String(error) });
    }
  });

  // Get timesheet blocking settings
  app.get('/api/settings/timesheet-blocking', async (req, res) => {
    try {
      const settings = await readSettings();
      res.json({ blockUnassignedProjectTasks: !!settings.blockUnassignedProjectTasks });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // Update timesheet blocking settings
  app.patch('/api/settings/timesheet-blocking', async (req, res) => {
    try {
      const { blockUnassignedProjectTasks } = req.body;
      const settings = await readSettings();
      settings.blockUnassignedProjectTasks = !!blockUnassignedProjectTasks;
      const success = await writeSettings(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to write settings' });
      }
      res.json({ blockUnassignedProjectTasks: !!settings.blockUnassignedProjectTasks });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  return httpServer;
}
