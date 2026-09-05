const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxClose = document.getElementById("lightboxClose");

const zoomableImages = document.querySelectorAll(".zoomable-image");


zoomableImages.forEach((image) => {

    image.addEventListener("click", () => {

        lightboxImage.src = image.src;
        lightboxImage.alt = image.alt;

        lightbox.classList.add("active");

        document.body.style.overflow = "hidden";

    });

});


function closeLightbox() {

    lightbox.classList.remove("active");

    document.body.style.overflow = "";

}


lightboxClose.addEventListener("click", closeLightbox);


lightbox.addEventListener("click", (event) => {

    if (event.target === lightbox) {
        closeLightbox();
    }

});


document.addEventListener("keydown", (event) => {

    if (event.key === "Escape") {
        closeLightbox();
    }

});
