CREATE TABLE "CompanyAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "ownership" TEXT NOT NULL,
    "supplier" TEXT,
    "rentalCost" DOUBLE PRECISION,
    "rentalStart" TIMESTAMP(3),
    "rentalEnd" TIMESTAMP(3),
    "responsibleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyAsset" ADD CONSTRAINT "CompanyAsset_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
