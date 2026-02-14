const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const MailingListSignup = sequelize.define(
  "MailingListSignup",
  {
    email: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
  },
  {
    tableName: "mailing_list_signups",
    timestamps: true,
  },
);

module.exports = MailingListSignup;
