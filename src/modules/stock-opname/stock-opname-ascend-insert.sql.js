// Query hitung stok Ascend per (CategoryID, FamilyID) — disalin apa adanya dari
// FrmStockOpname.vb (SaveStockOpnameMulti → sqlIns). Parameter: @NoSO, @CategoryID,
// @FamilyID, @EndDate, @WIDsCsv. Baris dengan hasil 0 tidak disimpan.
module.exports = `INSERT INTO StockOpnameAscend (NoSO,ItemID,Pcs,CategoryID,FamilyID)
SELECT
    @NoSO,
    Z.ItemID,
    (ISNULL(Z.QtyPrcIn,0)-ISNULL(Z.QtyUsg,0)+ISNULL(Z.QtyUbb,0)
      -ISNULL(Z.QtySls,0)-ISNULL(Z.QtyPR,0)+ISNULL(Z.QtyRTR,0)-ISNULL(Z.QtyAssm,0)+ISNULL(Z.TRFIN,0)-ISNULL(Z.TRFOUT,0)-ISNULL(Z.GDN,0)) AS Hasil
	  ,
      @CategoryID,
    @FamilyID
	--*
	
FROM (
    SELECT AA.ItemID, AA.ItemCode, ITEMNAME,
           ISNULL(BB.QtyPrcIn,0) AS QtyPrcIn,
           ISNULL(CC.QtyUsg,0)   AS QtyUsg,
           ISNULL(DD.QtyUsg,0)   AS QtyUbb,
           ISNULL(EE.QtySls,0)   AS QtySls,
           ISNULL(FF.QtyPrcOut,0) AS QtyPR,
		   ISNULL(GG.QtySlsRT,0) AS QtyRTR,
		    ISNULL(HH.QtySlsRT,0) AS QtyAssm,
			ISNULL(II.TRFIN,0) AS TRFIN,
			ISNULL(JJ.TRFOUT,0) AS TRFOUT,
			ISNULL(KK.QtySls,0) AS GDN
    FROM (
        SELECT I.ItemID,I.ItemCode, I.ITEMNAME
        FROM AS_GSU.dbo.IC_Items I
        WHERE 
		I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
          AND 
		  I.Disabled=0
          --AND I.ItemType=0
		  
    ) AA
    LEFT JOIN (
        SELECT 
		--*
		D.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtyPrcIn
        FROM AS_GSU.dbo.AP_PurchaseDetails D
        JOIN AS_GSU.dbo.AP_Purchases P ON P.PurchaseID=D.PurchaseID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = D.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE (P.PurchaseDate>'2025-12-31' and P.PurchaseDate<@EndDate AND P.Void=0 AND IsPurchase=1
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
		  ) OR ((P.PurchaseNumber='OP-2026') and D.WarehouseID in (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ',')) AND
		  P.PurchaseDate>='2025-12-31' and P.PurchaseDate<@EndDate AND P.Void=0 AND IsPurchase=1
		AND I.CategoryID=@CategoryID
        AND I.FamilyID = @FamilyID)
        GROUP BY D.ItemID
    ) BB ON BB.ItemID=AA.ItemID
    LEFT JOIN (
        SELECT U.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtyUsg
        FROM AS_GSU.dbo.IC_UsageDetails U
        JOIN AS_GSU.dbo.IC_Usages UH ON UH.UsageID=U.UsageID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.UsageDate<@EndDate AND UH.Void=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID AND UH.Approved=1
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.ItemID
    ) CC ON CC.ItemID=AA.ItemID
    LEFT JOIN (
        SELECT U.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,QtyAdjustBy,UOMLevel)) AS QtyUsg
        FROM AS_GSU.dbo.IC_AdjustmentDetails U
        JOIN AS_GSU.dbo.IC_Adjustments UH ON UH.AdjustmentID=U.AdjustmentID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.AdjustmentDate<@EndDate AND UH.Void=0 AND UH.Approved=1
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.ItemID
    ) DD ON DD.ItemID=AA.ItemID
    LEFT JOIN (
        SELECT U.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtySls
        FROM AS_GSU.dbo.AR_InvoiceDetails U
        inner JOIN AS_GSU.dbo.AR_Invoices UH ON UH.InvoiceID=U.InvoiceID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.InvoiceDate > '2025-12-31' AND UH.InvoiceDate<@EndDate AND UH.Void=0
		AND I.CategoryID=@CategoryID
		  AND DontPostToGL = 0 and IsInvoice = 1 AND IsDO = 0 AND UH.ConsignmentTransType <> 2
		  AND I.FamilyID = @FamilyID
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.ItemID
    ) EE ON EE.ItemID=AA.ItemID
    LEFT JOIN (
        SELECT D.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtyPrcOut
        FROM AS_GSU.dbo.AP_PurchaseDetails D
        JOIN AS_GSU.dbo.AP_Purchases P ON P.PurchaseID=D.PurchaseID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = D.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE P.PurchaseDate>='2025-12-31' and P.PurchaseDate<@EndDate AND P.Void=0 AND IsPurchase=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		 and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY D.ItemID
    ) FF ON FF.ItemID=AA.ItemID
	LEFT JOIN
	(
	SELECT U.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtySlsRT
        FROM AS_GSU.dbo.AR_InvoiceDetails U
        inner JOIN AS_GSU.dbo.AR_Invoices UH ON UH.InvoiceID=U.InvoiceID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.InvoiceDate>='2025-12-31' and UH.InvoiceDate<@EndDate AND UH.Void=0
		AND I.CategoryID=@CategoryID
		  AND DontPostToGL = 0 and IsInvoice = 0
		  AND I.FamilyID = @FamilyID
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.ItemID
	) GG ON GG.ItemID = AA.ItemID
    LEFT JOIN
	(
	SELECT U.MaterialItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS QtySlsRT
        FROM AS_GSU.dbo.IC_AssemblyDetails U
        inner JOIN AS_GSU.dbo.IC_Assembly UH ON UH.AssemblyID=U.AssemblyID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.MaterialItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.AssemblyDate<@EndDate AND UH.Void=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		--  AND DontPostToGL = 0 and IsInvoice = 0
		  --and u.MaterialItemID = 25091
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.MaterialItemID
	) HH ON HH.MaterialItemID = AA.ItemID
	LEFT JOIN
	(
	SELECT 
		--*
		D.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS TRFIN
        FROM AS_GSU.dbo.IC_MutationDetails D
        JOIN AS_GSU.dbo.IC_Mutations P ON P.MutationID=D.MutationID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = D.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE P.MutationDate<@EndDate AND P.Void=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		  and DestinationWarehouseID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY D.ItemID, I.ITEMNAME
		--ORDER BY I.ITEMNAME ASC
	)II ON II.ItemID = AA.ItemID
	LEFT JOIN
	(
	SELECT 
		--*
		D.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,Quantity,UOMLevel)) AS TRFOUT
        FROM AS_GSU.dbo.IC_MutationDetails D
        JOIN AS_GSU.dbo.IC_Mutations P ON P.MutationID=D.MutationID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = D.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE P.MutationDate>'2025-12-01' and P.MutationDate<@EndDate AND P.Void=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		  and SourceWarehouseID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY D.ItemID
	) JJ ON JJ.ItemID = AA.ItemID
	LEFT JOIN
	(
	SELECT 
		
		U.ItemID,
               SUM(AS_GSU.dbo.UDF_Common_ConvertToSmallestUOMEx(Packing2,Packing3,Packing4,u.Quantity,UOMLevel)) AS QtySls
        FROM AS_GSU.dbo.AR_GoodsDeliveryNoteDetails U
        inner JOIN AS_GSU.dbo.AR_GoodsDeliveryNotes UH ON UH.GoodsDeliveryNoteID=U.GoodsDeliveryNoteID
		INNER JOIN AS_GSU.dbo.IC_Items I ON I.ItemID = U.ItemID
		INNER JOIN AS_GSU.dbo.IC_StockFamily F ON F.FamilyID = I.FamilyID
        WHERE UH.GoodsDeliveryNoteDate<@EndDate AND UH.Void=0
		AND I.CategoryID=@CategoryID
          AND I.FamilyID = @FamilyID
		  --AND DontPostToGL = 0 and IsInvoice = 1
		  --and u.ItemID = 1442
		  and cog <> 0
		  and WAREHOUSEID IN (SELECT CAST([value] AS INT) FROM STRING_SPLIT(@WIDsCsv, ','))
        GROUP BY U.ItemID
	) KK ON KK.ItemID = AA.ItemID

) Z
WHERE (ISNULL(Z.QtyPrcIn,0)-ISNULL(Z.QtyUsg,0)+ISNULL(Z.QtyUbb,0)
        -ISNULL(Z.QtySls,0)-ISNULL(Z.QtyPR,0)+ISNULL(Z.QtyRTR,0)-ISNULL(Z.QtyAssm,0)+ISNULL(Z.TRFIN,0)-ISNULL(Z.TRFOUT,0)-ISNULL(Z.GDN,0))<>0
order by Z.itemname asc`;
