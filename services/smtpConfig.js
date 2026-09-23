function smtpPassword(environment = process.env) {
    return environment.SMTP_PASSWORD ?? environment.SMTP_PASS;
}

module.exports = { smtpPassword };