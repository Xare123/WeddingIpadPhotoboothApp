# Recipient retention

The recipient helper reserves a SecureStore metadata entry containing only an
opaque reference and creation time before writing the phone into its separate
SecureStore item. It serializes reservation, secret, queue-job, and cleanup
operations. Metadata contains no phone numbers; SQLite queue jobs contain only
opaque recipient references.

The index holds at most 16 references, including pending jobs and recent orphan
reservations. When full, a new request fails before writing its phone. Pending
jobs keep their recipient regardless of age. Completed jobs are eligible for
immediate cleanup. An indexed reference with no current job becomes eligible
for cleanup after 24 hours. This is eligibility at the next successful cleanup,
not a timer, guaranteed expiry, or background deletion deadline.

Cleanup first obtains a successful current queue read. Database failures or
invalid/unreadable metadata fail closed: no recipient is deleted. Secret deletion
precedes removal of its index entry, so interrupted cleanup remains retryable.
Ambiguous queue-write failures keep the reservation until reconciliation proves
that no pending job needs it. A database outage can therefore extend retention.

SecureStore cannot enumerate recipient items. Orphan secrets created by older
versions before this index existed cannot be discovered or cleaned by this
helper. Native Keychain/process-termination behavior still requires device
validation; helper tests simulate failures around durable write boundaries.
