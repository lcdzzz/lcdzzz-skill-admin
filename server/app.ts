import express from "express";
import { z } from "zod";
import { Manager } from "./service.js";
import { Failure } from "./storage.js";
export function createApp(manager: Manager) {
  const app = express();
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    const origin = req.headers.origin;
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
      (origin && origin !== `http://${host}`)
    ) {
      res.status(403).json({
        error: { code: "PATH_NOT_ALLOWED", message: "仅允许本机同源请求" },
      });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  const route =
    (fn: (req: any) => Promise<any>) =>
    async (req: any, res: any, next: any) => {
      try {
        res.json({ data: await fn(req) });
      } catch (e) {
        next(e);
      }
    };
  app.get(
    "/api/directories",
    route(() => manager.directories()),
  );
  app.post(
    "/api/directories",
    route((req) =>
      manager.register(
        z.object({ path: z.string().trim().min(1) }).parse(req.body).path,
      ),
    ),
  );
  app.delete(
    "/api/directories/:id",
    route((req) => manager.remove(req.params.id)),
  );
  app.get(
    "/api/skills",
    route(async (req) => {
      const filters = z
        .object({
          query: z.string().optional(),
          directoryId: z.string().optional(),
          sort: z
            .enum(["modifiedAt:asc", "modifiedAt:desc"])
            .default("modifiedAt:desc"),
        })
        .strict()
        .parse(req.query);
      const data = await manager.unifiedSkills();
      const query = (filters.query || "").toLocaleLowerCase();
      data.skills = data.skills
        .filter((s) =>
          `${s.name} ${s.description}`.toLocaleLowerCase().includes(query),
        )
        .filter(
          (s) =>
            !filters.directoryId ||
            s.instances.some(
              (instance: any) => instance.directoryId === filters.directoryId,
            ),
        )
        .sort(
          (a, b) =>
            (a.modifiedAt || "").localeCompare(b.modifiedAt || "") *
              (filters.sort.endsWith("asc") ? 1 : -1) ||
            a.realPath.localeCompare(b.realPath),
        );
      return data;
    }),
  );
  app.get(
    "/api/skills/:id",
    route(async (req) => {
      return manager.detail(req.params.id);
    }),
  );
  app.put(
    "/api/skills/:id/default-directory",
    route((req) => {
      const body = z
        .object({ directoryId: z.string().nullable() })
        .strict()
        .parse(req.body);
      return manager.setDefaultDirectory(req.params.id, body.directoryId);
    }),
  );
  app.get(
    "/api/operations",
    route(async (req) => {
      const { limit } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(10) })
        .strict()
        .parse(req.query);
      return { operations: await manager.operations(limit) };
    }),
  );
  const copySchema = z
    .object({
      skillIds: z.array(z.string()).min(1),
      targetDirectoryIds: z.array(z.string()).min(1),
    })
    .strict();
  app.post(
    "/api/skills/copy/preview",
    route((req) => manager.copyPreview(copySchema.parse(req.body))),
  );
  app.post(
    "/api/skills/copy",
    route((req) => {
      const body = copySchema
        .extend({
          mode: z.enum(["skill_md_only", "full_directory"]),
          decisions: z
            .array(
              z
                .object({
                  skillId: z.string(),
                  targetDirectoryId: z.string(),
                  action: z.enum(["skip", "overwrite", "cancel"]),
                })
                .strict(),
            )
            .default([]),
        })
        .strict()
        .parse(req.body);
      return manager.copy(body);
    }),
  );
  app.put(
    "/api/skills/:id",
    route((req) => {
      const body = z
        .object({
          content: z.string(),
          expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          force: z.boolean().default(false),
          description: z.string().max(500).optional(),
        })
        .parse(req.body);
      return manager.save(
        req.params.id,
        body.content,
        body.expectedFingerprint,
        body.force,
        body.description,
      );
    }),
  );
  app.post(
    "/api/skills",
    route((req) => {
      const body = z
        .object({
          targetDirectoryIds: z.array(z.string()).min(1).optional(),
          targetDirectoryId: z.string().optional(),
          directoryName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          content: z.string().optional(),
          name: z.string().optional(),
          description: z.string().optional(),
          whenToUse: z.string().optional(),
          instructions: z.string().optional(),
        })
        .refine(
          (value) =>
            value.targetDirectoryIds?.length || value.targetDirectoryId,
          { message: "至少选择一个目标目录", path: ["targetDirectoryIds"] },
        )
        .refine(
          (value) =>
            value.content !== undefined ||
            [
              value.name,
              value.description,
              value.whenToUse,
              value.instructions,
            ].every((item) => item !== undefined),
          { message: "必须提供文件内容或完整的结构化字段", path: ["content"] },
        )
        .parse(req.body);
      return manager.create({
        targetDirectoryIds: body.targetDirectoryIds || [
          body.targetDirectoryId!,
        ],
        directoryName: body.directoryName,
        content: body.content,
        name: body.name,
        description: body.description,
        whenToUse: body.whenToUse,
        instructions: body.instructions,
      });
    }),
  );
  const syncSchema = z
    .object({
      sourceDirectoryId: z.string(),
      targetDirectoryIds: z.array(z.string()).min(1),
    })
    .strict();
  app.post(
    "/api/skills/sync/preview",
    route((req) => manager.syncPreview(syncSchema.parse(req.body))),
  );
  app.post(
    "/api/skills/sync",
    route((req) => {
      const body = syncSchema
        .extend({
          decisions: z
            .array(
              z
                .object({
                  sourceSkillId: z.string(),
                  targetDirectoryId: z.string(),
                  action: z.enum(["skip", "overwrite", "cancel"]),
                })
                .strict(),
            )
            .default([]),
        })
        .strict()
        .parse(req.body);
      return manager.sync(body);
    }),
  );
  app.use("/api", (_req, res) => {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
  });
  app.use((error: any, _req: any, res: any, _next: any) => {
    const validation =
      error instanceof z.ZodError || error.type === "entity.parse.failed";
    res
      .status(validation ? 400 : error instanceof Failure ? error.status : 500)
      .json({
        error: {
          code: validation ? "VALIDATION_ERROR" : error.code || "IO_ERROR",
          message: validation ? "请求参数不符合要求" : error.message,
          details: validation ? error.issues : {},
        },
      });
  });
  return app;
}
