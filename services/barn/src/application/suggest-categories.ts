import type { Categorizer, ReceiptStore } from "@saddlebag/domain";

import type { BlobStore } from "./ports.js";

/**
 * Runs the categorizer over receipts that have no suggestion yet. Called
 * inline after each push here; a production barn would queue this. A
 * categorizer failure never fails the sync — the receipt just stays
 * unsuggested until the next try.
 */
export class SuggestCategories {
  constructor(
    private readonly receipts: ReceiptStore,
    private readonly categorizer: Categorizer,
    private readonly blobs: BlobStore,
  ) {}

  async execute(receiptIds: readonly string[]): Promise<{ attached: number; failed: number }> {
    let attached = 0;
    let failed = 0;
    for (const id of receiptIds) {
      const receipt = await this.receipts.findById(id);
      if (receipt === null || receipt.suggestion !== null || receipt.isApproved) continue;
      try {
        const image = receipt.imageRef === null ? null : await this.blobs.get(receipt.imageRef);
        const suggestion = await this.categorizer.categorize({
          vendor: receipt.fields.vendor,
          memo: receipt.fields.memo,
          totalCents: receipt.fields.totalCents,
          image,
        });
        if (suggestion === null) continue;
        const next = receipt.withSuggestion(suggestion, receipt.rev + 1);
        await this.receipts.save(next, await this.receipts.nextSeq());
        attached += 1;
      } catch {
        failed += 1;
      }
    }
    return { attached, failed };
  }
}
