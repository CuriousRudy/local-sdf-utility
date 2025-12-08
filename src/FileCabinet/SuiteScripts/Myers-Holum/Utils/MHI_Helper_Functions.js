function formatNum(amount) {
  var num = parseFloat(amount);
  var fixed = num.toFixed(2);

  return amount ? fixed : "0.00";
}

function formatPhone(phone) {
  var numberStr = phone.toString();
  //remove special characters
  var number = numberStr.replace(/[-.()@#&*]/g, "");
  var formattedPhone = number
    ? "(" +
      number.substring(0, 3) +
      ")" +
      number.substring(3, 6) +
      "-" +
      number.substring(6)
    : "";

  return formattedPhone;
}

function formatDate(date) {
  var months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  var month = months[date.getMonth()];
  var day = date.getDate().toString();
  var year = date.getFullYear();

  day = day.length > 1 ? day : "0" + day;

  return month + " " + day + ", " + year;
}

function formatTime(date) {
  var dateTime = format.format({
    value: date,
    type: format.Type.DATETIME,
    timezone: format.Timezone.AMERICA_CHICAGO,
  });

  var timeSplit = dateTime.split(" ");
  var time = timeSplit[1];
  var finalTime = time.split(":");

  return finalTime[0] + ":" + finalTime[1] + " " + timeSplit[2];
}

function xmlFormat(data) {
  var returnData = "";

  if (data && data.length > 0) {
    returnData = xml.escape(data);
  }
  return returnData;
}

const dateNowPac = format.parse({
  value: dateNow,
  type: format.Type.DATETIME,
  timezone: format.Timezone.AMERICA_CHICAGO,
});
