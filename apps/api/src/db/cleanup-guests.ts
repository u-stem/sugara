import { deleteExpiredGuests } from "../lib/cleanup-guests";

async function main() {
  const count = await deleteExpiredGuests();
  console.log(`Deleted ${count} expired guest account(s)`);
  process.exit(0);
}

main();
