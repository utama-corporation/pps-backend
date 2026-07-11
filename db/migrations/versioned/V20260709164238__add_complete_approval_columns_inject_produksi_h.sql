-- Endpoint PATCH /inject/:noProduksi/complete tidak lagi langsung men-set IsComplete=1.
-- Operator membuat request, atasan (permission produksi.inject.complete.approve) approve/reject.
-- IsComplete tetap final source-of-truth, hanya diset 1 saat request di-approve.

ALTER TABLE dbo.InjectProduksi_h ADD
    CompleteRequestStatus varchar(20) NOT NULL CONSTRAINT DF_InjectProduksi_h_CompleteRequestStatus DEFAULT ('NONE'),
    CompleteRequestedBy int NULL,
    CompleteRequestedByUsername varchar(100) NULL,
    CompleteRequestedAt datetime2 NULL,
    CompleteDecisionBy int NULL,
    CompleteDecisionByUsername varchar(100) NULL,
    CompleteDecisionAt datetime2 NULL,
    CompleteRejectReason nvarchar(500) NULL;
