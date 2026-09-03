import express from "express";

const app = express();

app.get("/trips/:id", (req, res) => {
  res.json({
    id: req.params.id,
    status: "completed",
    distanceKm: 8.5,
    durationMinutes: 22,
    vehicleType: "economy",
  });
});

app.listen(4000, () => {
  console.log("Trips stub escuchando en el puerto 4000");
});