# US postal city data

`us-postal-cities.json` maps active five-digit US ZIP codes to their state,
preferred postal city, and USPS-acceptable alternate cities. The preferred
city is always the first item in `cities`.

The compact index was generated from the MIT-licensed
[`seanpianka/Zipcodes`](https://github.com/seanpianka/Zipcodes) dataset. That
project combines city aliases from UnitedStatesZipCodes.org with active ZIP
information from the USPS ZIP Locale Detail and refreshes its packaged data
monthly.
