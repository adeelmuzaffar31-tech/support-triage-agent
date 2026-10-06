import { loadConfig } from "./config.ts";
import { PgRepository } from "./repo.ts";

const repo = PgRepository.fromUrl(loadConfig().DATABASE_URL);
try {
  const pending = await repo.listPendingApprovals();
  if (pending.length === 0) {
    console.log("No pending approvals.");
  } else {
    for (const p of pending) {
      console.log(`#${p.id}  [${p.action}]  order=${p.orderId ?? "-"}  trace=${p.traceId}`);
      console.log(`    why:   ${p.reason}`);
      console.log(`    draft: ${p.draftReply}\n`);
    }
  }
} finally {
  await repo.close();
}
