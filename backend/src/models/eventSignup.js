const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Event = require("./event");

const EventSignup = sequelize.define(
  "EventSignup",
  {
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING },
    zip: { type: DataTypes.STRING },
    newsletter: { type: DataTypes.BOOLEAN, defaultValue: false },
    textAlerts: { type: DataTypes.BOOLEAN, defaultValue: false },
    event_id: {
      type: DataTypes.INTEGER,
      references: { model: Event, key: "id" },
    },
  },
  {
    tableName: "event_signups",
    timestamps: true,
  },
);

Event.hasMany(EventSignup, { foreignKey: "event_id" });
EventSignup.belongsTo(Event, { foreignKey: "event_id" });

module.exports = EventSignup;
