// Followup: dump full listing + query result shape to inspect pricing,
// verification state, and per-tool methodPrice in detail.

import { ContextClient } from '@ctxprotocol/sdk';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  const apiKey = process.env.CONTEXT_API_KEY!;
  const client = new ContextClient({ apiKey });

  const tool = await client.discovery.get(
    '580555be-16e6-4ee0-8b26-3b41ad7a417e'
  );

  const out = path.join(
    __dirname,
    `listing-dump-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(out, JSON.stringify(tool, null, 2));

  console.log('FULL LISTING DUMP:');
  console.log(JSON.stringify(tool, null, 2));
  console.log('\nWritten to:', out);

  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
