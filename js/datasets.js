// ========================================
// MALAWI GEOPORTAL
// DATASET EXPLORER
// ========================================


// Get the search and filter elements
const searchInput = document.getElementById("dataset-search");
const departmentFilter = document.getElementById("department-filter");
const accessFilter = document.getElementById("access-filter");
const datasetCards = document.querySelectorAll(".dataset-card");
const datasetCount = document.getElementById("dataset-count");
const searchButton = document.getElementById("search-button");


// Function to filter datasets
function filterDatasets() {

    // Get the user's search text
    const searchText = searchInput.value.toLowerCase();

    // Get selected filters
    const selectedDepartment = departmentFilter.value.toLowerCase();
    const selectedAccess = accessFilter.value.toLowerCase();

    // Keep track of visible datasets
    let visibleCount = 0;


    // Check every dataset card
    datasetCards.forEach(function(card) {

        // Get all text inside the card
        const cardText = card.textContent.toLowerCase();

        // Check search
        const matchesSearch =
            cardText.includes(searchText);

        // Check department
        const matchesDepartment =
            selectedDepartment === "all" ||
            cardText.includes(selectedDepartment);

        // Check access level
        const matchesAccess =
            selectedAccess === "all" ||
            cardText.includes(selectedAccess);

        // Decide whether to show the card
        if (
            matchesSearch &&
            matchesDepartment &&
            matchesAccess
        ) {

            card.style.display = "block";
            visibleCount++;

        } else {

            card.style.display = "none";

        }

    });


    // Update the dataset count
    datasetCount.textContent =
        visibleCount + " dataset" +
        (visibleCount === 1 ? "" : "s");
}


// Search and filter events
searchInput.addEventListener("input", filterDatasets);
departmentFilter.addEventListener("change", filterDatasets);
accessFilter.addEventListener("change", filterDatasets);
searchButton.addEventListener("click", filterDatasets);