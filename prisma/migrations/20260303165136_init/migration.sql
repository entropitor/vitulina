-- CreateTable
CREATE TABLE "DevServer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_name" TEXT NOT NULL,
    "working_directory" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "server_name" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "port" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DevServer_project_name_env_server_name_key" ON "DevServer"("project_name", "env", "server_name");
