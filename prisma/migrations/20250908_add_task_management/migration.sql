-- ============================================================
-- Migration: إدارة المهام (Task Management)
-- تضيف جداول: Task, TaskEvent, TaskAttachment
-- مع العلاقات والفهارس المطلوبة لأداء الاستعلامات
-- ============================================================

-- CreateTable: Task
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "taskNumber" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "size" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'new',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "reviewRequestedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedOnFirstReview" BOOLEAN NOT NULL DEFAULT false,
    "returnCount" INTEGER NOT NULL DEFAULT 0,
    "reviewNote" TEXT,
    "waitingMinutes" INTEGER NOT NULL DEFAULT 0,
    "waitingSince" TIMESTAMP(3),
    "waitingReason" TEXT,
    "cancelReason" TEXT,
    "recurring" TEXT,
    "parentTaskId" TEXT,
    "lastUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- Create unique index for taskNumber ( SERIAL UNIQUE )
CREATE UNIQUE INDEX "Task_taskNumber_key" ON "Task"("taskNumber");

-- Indexes for Task performance
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- Foreign keys for Task
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_creatorId_fkey"
    FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_closedById_fkey"
    FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_lastUpdatedById_fkey"
    FOREIGN KEY ("lastUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================

-- CreateTable: TaskEvent
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "oldDueDate" TIMESTAMP(3),
    "newDueDate" TIMESTAMP(3),
    "oldAssigneeId" TEXT,
    "newAssigneeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- Index for chronological event lookup per task
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");

-- Foreign keys for TaskEvent
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================

-- CreateTable: TaskAttachment
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- Index for listing attachments per task
CREATE INDEX "TaskAttachment_taskId_idx" ON "TaskAttachment"("taskId");

-- Foreign keys for TaskAttachment
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploaderId_fkey"
    FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
