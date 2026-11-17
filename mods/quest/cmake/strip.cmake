# Keep post-link commands anchored to the actual target path.
cmake_language(DEFER DIRECTORY ${CMAKE_SOURCE_DIR} CALL _setup_linux_strip_project())

function(_setup_linux_strip_project)
    if(CMAKE_SYSTEM_NAME STREQUAL "Linux" OR CMAKE_SYSTEM_NAME STREQUAL "Android")
        message("Enabling Stripping")
        add_custom_command(TARGET ${COMPILE_ID} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:${COMPILE_ID}>/debug"
            COMMAND ${CMAKE_STRIP} -d --strip-all "$<TARGET_FILE:${COMPILE_ID}>" -o "$<TARGET_FILE_DIR:${COMPILE_ID}>/stripped_lib${COMPILE_ID}.so"
            COMMAND ${CMAKE_COMMAND} -E rename "$<TARGET_FILE:${COMPILE_ID}>" "$<TARGET_FILE_DIR:${COMPILE_ID}>/debug/lib${COMPILE_ID}.so"
            COMMAND ${CMAKE_COMMAND} -E rename "$<TARGET_FILE_DIR:${COMPILE_ID}>/stripped_lib${COMPILE_ID}.so" "$<TARGET_FILE:${COMPILE_ID}>"
            COMMENT "Preserve debug symbols and strip the distributable Quest library"
            VERBATIM
        )
    endif()
endfunction(_setup_linux_strip_project)
