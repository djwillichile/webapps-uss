// Obtenemos referencias a los elementos del DOM
const inputCelsius = document.getElementById("celsius");
const btnConvertir = document.getElementById("convertir");
const outputFahrenheit = document.getElementById("fahrenheit");
// Función para convertir
function convertirCelsiusAFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
}
// Evento al hacer clic en convertir
btnConvertir.addEventListener("click", () => {
    const celsius = parseFloat(inputCelsius.value);
    if (!isNaN(celsius)) {
        const fahrenheit = convertirCelsiusAFahrenheit(celsius);
        outputFahrenheit.textContent = `${celsius}°C son ${fahrenheit.toFixed(2)}°F`;
    } else {
        outputFahrenheit.textContent = "Ingresa una temperatura válida";
    }
});