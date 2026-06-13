const service = require("./master-material-service");

function parseLookupParams(req) {
  const idCetakanRaw = req.query.idCetakan;
  const idWarnaRaw = req.query.idWarna;
  const idFurnitureMaterialRaw = req.query.idFurnitureMaterial;

  const idCetakan =
    idCetakanRaw === undefined || idCetakanRaw === null || idCetakanRaw === ""
      ? null
      : Number(idCetakanRaw);

  const idWarna =
    idWarnaRaw === undefined || idWarnaRaw === null || idWarnaRaw === ""
      ? null
      : Number(idWarnaRaw);

  const idFurnitureMaterial =
    idFurnitureMaterialRaw === undefined ||
    idFurnitureMaterialRaw === null ||
    idFurnitureMaterialRaw === ""
      ? null
      : Number(idFurnitureMaterialRaw);

  return {
    idCetakan,
    idWarna,
    idFurnitureMaterial,
  };
}

function isInvalidLookupParams({ idCetakan, idWarna, idFurnitureMaterial }) {
  return (
    idCetakan === null ||
    Number.isNaN(idCetakan) ||
    idWarna === null ||
    Number.isNaN(idWarna) ||
    (idFurnitureMaterial !== null && Number.isNaN(idFurnitureMaterial))
  );
}

async function getOutputByParams(req, res) {
  const { username } = req;
  const params = parseLookupParams(req);

  if (isInvalidLookupParams(params)) {
    return res.status(400).json({
      success: false,
      message:
        "Provide ?idCetakan=<int>&idWarna=<int>&idFurnitureMaterial=<int|optional>",
      error: {
        fields: ["idCetakan", "idWarna", "idFurnitureMaterial"],
      },
    });
  }

  console.log("Fetching material output by params |", {
    username,
    ...params,
  });

  try {
    const result = await service.getOutputByParams(params);

    if (result.items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No output mapping found for provided parameters",
        data: {
          beratProdukHasilTimbang: null,
          outputType: null,
          items: [],
        },
        meta: params,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Output mapping retrieved successfully",
      data: {
        beratProdukHasilTimbang: null,
        outputType: result.outputType,
        items: result.items,
      },
      meta: params,
    });
  } catch (error) {
    console.error("Error fetching material output by params:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getFurnitureWipCompositions(req, res) {
  const { username } = req;

  console.log("Fetching furniture WIP compositions |", { username });

  try {
    const data = await service.getFurnitureWipCompositions();

    return res.status(200).json({
      success: true,
      message: "FurnitureWIP compositions retrieved successfully",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching FurnitureWIP compositions:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

async function getBarangJadiCompositions(req, res) {
  const { username } = req;

  console.log("Fetching barang jadi compositions |", { username });

  try {
    const data = await service.getBarangJadiCompositions();

    return res.status(200).json({
      success: true,
      message: "BarangJadi compositions retrieved successfully",
      totalData: data.length,
      data,
    });
  } catch (error) {
    console.error("Error fetching BarangJadi compositions:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

module.exports = {
  getOutputByParams,
  getFurnitureWipCompositions,
  getBarangJadiCompositions,
};
