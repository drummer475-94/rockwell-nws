# NWS Forecast

A single-page web application that provides a detailed weather forecast using data from the National Weather Service (NWS) and other sources.

## Features

*   **Current Weather:** Get up-to-the-minute weather conditions for your location.
*   **Hourly & Daily Forecasts:** Plan ahead with detailed 12-hour and 7-day forecasts.
*   **Interactive Radar:** View an animated weather radar with controls for play/pause, speed, and opacity.
*   **Lake Levels:** Check the water levels for High Rock Lake and Tuckertown Lake.
*   **Geolocation:** Automatically fetches the forecast for your current location.
*   **Light & Dark Mode:** The interface adapts to your system's color scheme preference.

## Data Sources

This application utilizes data from the following sources:

*   **Forecast Data:** [National Weather Service (NWS) API](https://api.weather.gov/)
*   **Animated Radar:** [RainViewer API](https://www.rainviewer.com/api.html)
*   **Static Radar:** NEXRAD data from [Iowa State Mesonet](https://mesonet.agron.iastate.edu/)
*   **Base Map:** [OpenStreetMap](https://www.openstreetmap.org/)
*   **Sunrise/Sunset Times:** [sunrise-sunset.org API](https://sunrise-sunset.org/api)
*   **Lake Level Data:**
    *   USGS National Water Information System (NWIS)
    *   NOAA National Water Prediction Service (NWPS)
    *   Cube Carolinas

## Usage

No build step or server is required. Simply open the `index.html` file in a modern web browser.

The application will request permission to access your location to provide a local forecast. If you decline, it will default to a preset location (Rockwell, NC).

## Development

This project is built with vanilla HTML, CSS, and JavaScript. There are no external dependencies to install.

### File Structure

*   `index.html`: The main HTML file that defines the structure of the application.
*   `main.js`: Contains all the JavaScript for the application, including API calls, data processing, and DOM manipulation. All functions are documented using JSDoc.
*   `tests.html`: A page for running the unit tests.
*   `tests.js`: Contains unit tests for the helper functions in `main.js`, using the QUnit framework.

### Running Tests

To run the tests, simply open the `tests.html` file in your web browser. The test results will be displayed on the page.
