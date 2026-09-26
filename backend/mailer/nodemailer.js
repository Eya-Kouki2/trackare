const dotenv = require('dotenv');
const nodemailer = require('nodemailer') ;

dotenv.config();

const sender = {
  email: process.env.EMAIL_USER,
  name: process.env.EMAIL_NAME || 'MediSmart',
};

const nodemailerClient = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

module.exports = {
  nodemailerClient,
  sender
}