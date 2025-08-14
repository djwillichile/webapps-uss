// Obtenemos referencias a los elementos del DOM
const valorElemento = document.getElementById("valor");
const btnIncrementar = document.getElementById("incrementar");
const btnDecrementar = document.getElementById("decrementar");
// Variable para almacenar el valor del contador
let contador = 0;
// Función para actualizar el valor mostrado
function actualizarContador() {
    valorElemento.textContent = contador;
}

// Evento para incrementar
btnIncrementar.addEventListener("click", () => {
    contador++;
    actualizarContador();
});

// Evento para decrementar
btnDecrementar.addEventListener("click", () => {
    contador--;
    actualizarContador();
});