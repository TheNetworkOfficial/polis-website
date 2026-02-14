const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ContactMessage = sequelize.define(
  "ContactMessage",
  {
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING },
    zip: { type: DataTypes.STRING },
    subject: { type: DataTypes.STRING },
    message: { type: DataTypes.TEXT, allowNull: false },
    read: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    tableName: "contact_messages",
    timestamps: true,
  },
);

module.exports = ContactMessage;
