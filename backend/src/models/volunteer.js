const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Volunteer = sequelize.define(
  "Volunteer",
  {
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING },
    zip: { type: DataTypes.STRING },
    discord: { type: DataTypes.STRING },
  },
  {
    tableName: "volunteers",
    timestamps: true,
  },
);

module.exports = Volunteer;
