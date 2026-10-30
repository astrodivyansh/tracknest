import { asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { departments, persons } from "@/db/schema";
import { api, paging, readJson } from "@/lib/api";

const fields = {
  id: persons.id,
  name: persons.name,
  email: persons.email,
  employeeId: persons.employeeId,
  department: departments.name,
};

export const GET = api("read", (ctx, req) => {
  const p = paging(req);
  return withOrg(ctx.orgId, async (tx) => ({
    data: await tx
      .select(fields)
      .from(persons)
      .leftJoin(departments, eq(departments.id, persons.departmentId))
      .where(isNull(persons.deletedAt))
      .orderBy(asc(persons.name), asc(persons.id))
      .limit(p.limit)
      .offset(p.offset),
    page: p.page,
    limit: p.limit,
    total: (await tx.select({ n: count() }).from(persons).where(isNull(persons.deletedAt)))[0].n,
  }));
});

const body = z.object({
  name: z.string().trim().min(1),
  email: z.email().optional(),
  employeeId: z.string().trim().min(1).optional(),
  departmentId: z.uuid().optional(),
});

export const POST = api("write", async (ctx, req) => {
  const input = body.parse(await readJson(req));
  const person = await withOrg(ctx.orgId, async (tx) => {
    const [p] = await tx.insert(persons).values({ ...input, orgId: ctx.orgId }).returning({ id: persons.id });
    return (await tx.select(fields).from(persons).leftJoin(departments, eq(departments.id, persons.departmentId)).where(eq(persons.id, p.id)))[0];
  });
  return Response.json(person, { status: 201 });
});
