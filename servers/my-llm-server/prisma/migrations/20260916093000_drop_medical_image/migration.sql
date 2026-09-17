-- DropTable
DROP TABLE IF EXISTS "ImageGeneration";

-- DropTable
DROP TABLE IF EXISTS "MedicalRecord";

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "kind" SET DEFAULT 'customer-service';
