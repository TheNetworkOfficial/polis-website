const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Event = sequelize.define(
  "Event",
  {
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    eventDate: { type: DataTypes.DATE, allowNull: false },
    location: { type: DataTypes.STRING },
    // Optional path to a thumbnail image stored under /uploads
    thumbnailImage: { type: DataTypes.STRING },
  },
  {
    tableName: "events",
    timestamps: true,
  },
);

module.exports = Event;
