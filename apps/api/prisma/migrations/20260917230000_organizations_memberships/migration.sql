CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE UNIQUE INDEX "organization_memberships_organizationId_userId_key" ON "organization_memberships"("organizationId", "userId");
CREATE INDEX "organization_memberships_userId_idx" ON "organization_memberships"("userId");
CREATE INDEX "organization_memberships_organizationId_role_idx" ON "organization_memberships"("organizationId", "role");
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
VALUES (md5(random()::text || clock_timestamp()::text), 'Mastercraft Auto Repair', 'mastercraft-auto-repair', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "organization_memberships" ("id", "organizationId", "userId", "role", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || users.id), organizations.id, users.id,
       CASE WHEN users.id = (SELECT id FROM "users" ORDER BY "createdAt", id LIMIT 1) THEN 'owner' ELSE 'technician' END,
       CURRENT_TIMESTAMP
FROM "users" CROSS JOIN "organizations"
WHERE organizations.slug = 'mastercraft-auto-repair'
ON CONFLICT ("organizationId", "userId") DO NOTHING;