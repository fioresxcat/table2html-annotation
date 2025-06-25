# app.py
import os
import json
import base64
import shutil
import re
from datetime import datetime
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import mimetypes
import time
import pdb
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from hightlight_diff import compare_ocr_results
from hightlight_diff import compare_ocr_results_from_content
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
IMAGES_DIR = os.environ.get('IMAGES_DIR', '/path/to/your/images')  # Set this to your images directory
EXCLUDED_DIR = os.environ.get('EXCLUDED_DIR', os.path.join(IMAGES_DIR, 'excluded'))  # Default to a subdirectory of images
PORT = int(os.environ.get('PORT', 5000))
MODEL_NAMES = ["gemini_2.0_flash", "gemini_2.5_flash"]

# File index cache
file_index = None
index_last_updated = 0
INDEX_CACHE_DURATION = 300  # increased to 5 minutes
file_stats_cache = {}  # Cache for file stats

def sanitize_table_html(table_html):
    """
    Clean up malformed table HTML by handling multiple opening tags
    """
    # Remove bare <table> if followed by <table border="1">
    cleaned = re.sub(r'<table>\s*<table\s+[^>]*>', r'<table border="1">', table_html)
    
    # Count opening and closing tags
    open_tags = len(re.findall(r'<table[^>]*>', cleaned))
    close_tags = len(re.findall(r'</table>', cleaned))
    
    # Add missing closing tags
    if open_tags > close_tags:
        cleaned += '</table>' * (open_tags - close_tags)
    
    return cleaned

def parse_tables_from_text(text):
    """
    Parse text content and extract tables, replacing them with <TABLE></TABLE> markers
    Returns:
    - outside_text: Text with tables replaced by markers
    - tables: List of table HTML strings
    """
    # Regular expression to find table tags and their content
    table_pattern = re.compile(r'<table[^>]*>.*?</table>', re.DOTALL | re.IGNORECASE)
    
    # Find all tables
    tables = table_pattern.findall(text)
    
    # Clean up each table
    cleaned_tables = [sanitize_table_html(table) for table in tables]
    
    # Replace each table with a marker
    outside_text = text
    for table in tables:
        outside_text = outside_text.replace(table, '<TABLE></TABLE>')
    
    return {
        'outside_text': outside_text,
        'tables': cleaned_tables
    }

def read_text_file(file_path):
    """Read and parse a text file containing tables"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return parse_tables_from_text(content)
    except Exception as e:
        print(f"Error reading text file: {str(e)}")
        return None

# Create the excluded directory if it doesn't exist
def ensure_excluded_dir():
    if not os.path.exists(EXCLUDED_DIR):
        os.makedirs(EXCLUDED_DIR, exist_ok=True)
        print(f"Created excluded directory: {EXCLUDED_DIR}")

def get_cached_file_stats(file_path):
    """Get file stats with caching to reduce file system calls"""
    global file_stats_cache
    
    current_time = time.time()
    if file_path in file_stats_cache:
        stats, timestamp = file_stats_cache[file_path]
        if current_time - timestamp < INDEX_CACHE_DURATION:
            return stats
    
    try:
        stats = os.stat(file_path)
        file_stats_cache[file_path] = (stats, current_time)
        return stats
    except:
        return None

def get_file_content(file_path):
    """Read current content directly from disk with caching"""
    global file_stats_cache
    
    # Check if we have cached stats and if file was modified
    current_time = time.time()
    if file_path in file_stats_cache:
        stats, timestamp = file_stats_cache[file_path]
        if current_time - timestamp < INDEX_CACHE_DURATION:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    return content
            except Exception:
                pass
    
    # If cache miss or error, update cache and try again
    try:
        stats = os.stat(file_path)
        file_stats_cache[file_path] = (stats, current_time)
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Error reading file {file_path}: {str(e)}")
        return None

def get_parsed_content(file_path):
    """Read and parse current content from disk"""
    content = get_file_content(file_path)
    if content is not None:
        return parse_tables_from_text(content)
    return None

def build_file_index():
    """Build or refresh the file index"""
    global file_index, index_last_updated
    
    # Only rebuild if it's been more than cache duration since last update
    now = time.time()
    if file_index is not None and (now - index_last_updated < INDEX_CACHE_DURATION):
        return file_index
    
    print("Building file index...")
    index = []
    
    # Make sure the directory exists
    if not os.path.exists(IMAGES_DIR):
        print(f"Warning: Images directory not found: {IMAGES_DIR}")
        return []
    
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff']
    
    # Get all files at once to reduce directory access
    try:
        all_files = set(os.listdir(IMAGES_DIR))
    except Exception as e:
        print(f"Error listing directory: {str(e)}")
        return []
    
    # Process image files
    image_files = [f for f in all_files if any(f.lower().endswith(ext) for ext in image_extensions)]
    
    for filename in sorted(image_files):
        file_path = os.path.join(IMAGES_DIR, filename)
        if not os.path.isfile(file_path):
            continue
            
        # Get base name without extension
        base_name = os.path.splitext(filename)[0]
        # For each model, check for annotation txt
        txt_paths = {}
        has_txt = {}
        for model in MODEL_NAMES:
            txt_file = f"{base_name}-{model}.txt"
            txt_path = os.path.join(IMAGES_DIR, txt_file)
            if txt_file not in all_files:
                os.makedirs(os.path.dirname(txt_path), exist_ok=True)
                if not os.path.exists(txt_path):
                    with open(txt_path, 'w') as f:
                        f.write("")
            txt_paths[model] = txt_path
            has_txt[model] = True
        
        # Use cached stats
        stats = get_cached_file_stats(file_path)
        if not stats:
            continue
        
        index.append({
            "id": base_name,
            "name": filename,
            "path": file_path,
            "txtPaths": txt_paths,
            "hasTxts": has_txt,
            "size": stats.st_size,
            "lastModified": stats.st_mtime
        })
    
    file_index = index
    index_last_updated = now
    return index

def get_mime_type(file_path):
    """Get the MIME type of a file"""
    mime_type, _ = mimetypes.guess_type(file_path)
    return mime_type or 'application/octet-stream'

@app.route('/api/files', methods=['GET'])
def list_files():
    """Get list of files (paginated)"""
    try:
        # Parse query parameters
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=50, type=int)
        
        # Get file index
        index = build_file_index()
        total_files = len(index)
        total_pages = (total_files + limit - 1) // limit  # Ceiling division
        
        # Calculate start and end indices
        start_index = (page - 1) * limit
        end_index = min(start_index + limit, total_files)
        
        # Get paginated files
        paginated_files = index[start_index:end_index]
        
        # Return only necessary information for listing
        files_data = [{
            "id": file["id"],
            "name": file["name"],
            "hasTxt": file["hasTxts"][MODEL_NAMES[0]] if MODEL_NAMES[0] in file["hasTxts"] else False,
            "hasAnnotation": file["hasTxts"][MODEL_NAMES[1]] if MODEL_NAMES[1] in file["hasTxts"] else False,
            "lastModified": file["lastModified"]
        } for file in paginated_files]
        
        return jsonify({
            "success": True,
            "page": page,
            "limit": limit,
            "totalFiles": total_files,
            "totalPages": total_pages,
            "files": files_data
        })
    except Exception as e:
        print(f"Error listing files: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>', methods=['GET'])
def get_file_details(file_id):
    """Get file details by ID"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Calculate pagination info
        total_files = len(index)
        file_index = next(i for i, f in enumerate(index) if f["id"] == file_id)
        page_size = int(request.args.get('page_size', 50))  # Default page size
        current_page = (file_index // page_size) + 1
        file_index_in_page = file_index % page_size
        
        # Add pagination info to response
        response = {
            "success": True,
            "file": file_info,
            "pagination": {
                "totalFiles": total_files,
                "currentPage": current_page,
                "pageSize": page_size,
                "fileIndex": file_index + 1,  # 1-based index for display
                "fileIndexInPage": file_index_in_page + 1,  # 1-based index for display
            }
        }
        
        return jsonify(response)
    except Exception as e:
        print(f"Error getting file details: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/image', methods=['GET'])
def get_image(file_id):
    """Get image file"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Return the image file
        return send_file(
            file_info["path"],
            mimetype=get_mime_type(file_info["path"]),
            as_attachment=False
        )
    except Exception as e:
        print(f"Error serving image: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/base64image', methods=['GET'])
def get_base64_image(file_id):
    """Get image as base64 string"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Read image file and convert to base64
        with open(file_info["path"], 'rb') as img_file:
            encoded_image = base64.b64encode(img_file.read()).decode('utf-8')
        
        mime_type = get_mime_type(file_info["path"])
        data_url = f"data:{mime_type};base64,{encoded_image}"
        
        return jsonify({
            "success": True,
            "imageData": data_url
        })
    except Exception as e:
        print(f"Error serving base64 image: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/txt', methods=['GET'])
def get_txt(file_id):
    """Get text content"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info or not file_info["hasTxts"][MODEL_NAMES[0]]:
            return jsonify({"error": f"Text file for {MODEL_NAMES[0]} not found"}), 404
        
        # Read text file
        with open(file_info["txtPaths"][MODEL_NAMES[0]], 'r', encoding='utf-8') as txt_file:
            txt_content = txt_file.read()
        
        return jsonify({
            "success": True,
            "text": txt_content
        })
    except Exception as e:
        print(f"Error serving text: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/annotations', methods=['GET'])
def get_annotations(file_id):
    """Get annotations"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # If no annotations exist yet, return empty
        if not file_info["hasTxts"][MODEL_NAMES[0]] and not file_info["hasTxts"][MODEL_NAMES[1]]:
            return jsonify({
                "success": True,
                "annotations": {
                    "tableId": file_id,
                    "timestamp": datetime.now().isoformat(),
                    "corrections": []
                }
            })
        
        # Read annotation file
        with open(file_info["txtPaths"][MODEL_NAMES[0]], 'r', encoding='utf-8') as annotation_file:
            annotations = json.load(annotation_file)
        
        return jsonify({
            "success": True,
            "annotations": annotations
        })
    except Exception as e:
        print(f"Error serving annotations: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/annotations', methods=['POST'])
def save_annotations(file_id):
    """Save annotations"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Get annotation data from request
        annotation_data = request.json
        
        # Set the annotation path
        for model in MODEL_NAMES:
            annotation_path = file_info["txtPaths"].get(model) or os.path.join(IMAGES_DIR, f"{file_id}-{model}.txt")
        with open(annotation_path, 'w', encoding='utf-8') as annotation_file:
            json.dump(annotation_data, annotation_file, indent=2)
        
        # Update file index to show this file now has annotations
        for model in MODEL_NAMES:
            file_info["hasTxts"][model] = True
            file_info["txtPaths"][model] = annotation_path
        
        return jsonify({
            "success": True,
            "message": "Annotations saved successfully"
        })
    except Exception as e:
        print(f"Error saving annotations: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/export-txt', methods=['POST'])
def export_txt(file_id):
    """Export corrected text"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Get text content from request
        txt_content = request.json.get("text")
        if not txt_content:
            return jsonify({"error": "No text content provided"}), 400
        
        # Set the export path
        export_path = os.path.join(IMAGES_DIR, f"{file_id}_corrected.txt")
        
        # Save text to file
        with open(export_path, 'w', encoding='utf-8') as txt_file:
            txt_file.write(txt_content)
        
        return jsonify({
            "success": True,
            "message": "Text exported successfully",
            "path": export_path
        })
    except Exception as e:
        print(f"Error exporting text: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/export-all-annotations', methods=['GET'])
def export_all_annotations():
    """Export all annotations"""
    try:
        index = build_file_index()
        
        # Filter files that have annotations
        annotated_files = [file for file in index if any(file["hasTxts"][model] for model in MODEL_NAMES)]
        
        if not annotated_files:
            return jsonify({"error": "No annotated files found"}), 404
        
        # Collect all annotations
        annotations = []
        for file in annotated_files:
            result = {}
            for model in MODEL_NAMES:
                if file["hasTxts"][model]:
                    try:
                        with open(file["txtPaths"][model], 'r', encoding='utf-8') as annotation_file:
                            annotation_data = json.load(annotation_file)
                        result[model] = annotation_data
                    except Exception as e:
                        print(f"Error reading annotation file {file['txtPaths'][model]}: {str(e)}")
            annotations.append({
                "id": file["id"],
                "name": file["name"],
                "path": file["path"],
                "annotations": result
            })
        
        # Create export data
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_data = {
            "timestamp": datetime.now().isoformat(),
            "files": annotations
        }
        
        # Create export file
        export_filename = f"annotations_export_{timestamp}.json"
        export_path = os.path.join(IMAGES_DIR, export_filename)
        
        with open(export_path, 'w', encoding='utf-8') as export_file:
            json.dump(export_data, export_file, indent=2)
        
        # Send the file to the client
        return send_file(
            export_path,
            mimetype='application/json',
            as_attachment=True,
            download_name=export_filename
        )
    except Exception as e:
        print(f"Error exporting all annotations: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/status', methods=['GET'])
def get_status():
    """Get server status"""
    return jsonify({
        "status": "running",
        "imagesDirectory": IMAGES_DIR,
        "fileCount": len(build_file_index()),
        "serverTime": datetime.now().isoformat()
    })

# The only endpoint we really need for HTML editing is:
@app.route('/api/files/<file_id>/update-txt', methods=['POST'])
def update_txt(file_id):
    """Update the original text file"""
    try:
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        # Get text content from request
        txt_content = request.json.get("text")
        if not txt_content:
            return jsonify({"error": "No text content provided"}), 400
        
        # Check if text file exists
        for model in MODEL_NAMES:
            txt_path = file_info["txtPaths"].get(model)
            if not txt_path:
                # Create a new text file if it doesn't exist
                base_name = file_id
                txt_path = os.path.join(IMAGES_DIR, f"{base_name}-{model}.txt")
        
        # Save text to the file
        for model in MODEL_NAMES:
            with open(file_info["txtPaths"][model], 'w', encoding='utf-8') as txt_file:
                txt_file.write(txt_content)
        
        # Update the file index
        for model in MODEL_NAMES:
            file_info["hasTxts"][model] = True
            file_info["txtPaths"][model] = file_info["txtPaths"][model]
        
        return jsonify({
            "success": True,
            "message": "Text file updated successfully",
            "path": file_info["txtPaths"][MODEL_NAMES[0]]
        })
    except Exception as e:
        print(f"Error updating text file: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/exclude', methods=['POST'])
def exclude_file(file_id):
    """Move a file and its text to the excluded directory"""
    try:
        # Make sure the excluded directory exists
        ensure_excluded_dir()
        
        index = build_file_index()
        
        # Find file in index
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        image_path = file_info["path"]
        image_filename = os.path.basename(image_path)
        
        # Get text path if it exists
        txt_paths = {model: file_info["txtPaths"].get(model) for model in MODEL_NAMES if file_info["hasTxts"][model]}
        txt_filenames = [os.path.basename(txt_path) for txt_path in txt_paths.values() if txt_path]
        
        # Move image file
        excluded_image_path = os.path.join(EXCLUDED_DIR, image_filename)
        shutil.move(image_path, excluded_image_path)
        
        moved_files = [image_filename]
        
        # Move text files if they exist
        for model in MODEL_NAMES:
            txt_path = file_info["txtPaths"].get(model)
            if txt_path and os.path.exists(txt_path):
                excluded_txt_path = os.path.join(EXCLUDED_DIR, os.path.basename(txt_path))
                shutil.move(txt_path, excluded_txt_path)
                moved_files.append(os.path.basename(txt_path))
        
        # Force rebuild of the file index
        global file_index, index_last_updated
        file_index = None
        index_last_updated = 0
        
        return jsonify({
            "success": True,
            "message": f"File moved to excluded directory: {EXCLUDED_DIR}",
            "excludedDir": EXCLUDED_DIR,
            "movedFiles": moved_files
        })
    except Exception as e:
        print(f"Error excluding file: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/parsed-txt', methods=['GET'])
def get_parsed_txt(file_id):
    """Get parsed text content"""
    try:
        index = build_file_index()
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        result = {}
        for model in MODEL_NAMES:
            txt_path = file_info["txtPaths"].get(model)
            if txt_path and os.path.exists(txt_path):
                parsed = get_parsed_content(txt_path)
                if parsed:
                    result[model] = {
                        "outside_text": parsed["outside_text"],
                        "tables": parsed["tables"]
                    }
                else:
                    result[model] = None
            else:
                result[model] = None
        return jsonify({
            "success": True,
            "annotations": result
        })
    except Exception as e:
        print(f"Error getting parsed text: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/files/<file_id>/update-parsed-txt', methods=['POST'])
def update_parsed_txt(file_id):
    """Update text file from parsed content"""
    try:
        index = build_file_index()
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        
        data = request.json
        # Expecting: { gemini_2.0_flash: {outside_text, tables}, gemini_2.5_flash: {outside_text, tables} }
        
        saved_models = []
        final_content = None
        final_model = None
        
        for model in MODEL_NAMES:
            model_data = data.get(model)
            if not model_data:
                continue
                
            outside_text = model_data.get("outside_text")
            tables = model_data.get("tables", [])
            if outside_text is None:
                continue
                
            txt_path = file_info["txtPaths"].get(model)
            if not txt_path:
                base_name = file_id
                txt_path = os.path.join(IMAGES_DIR, f"{base_name}-{model}.txt")
                
            marker_count = outside_text.count('<TABLE></TABLE>')
            if marker_count != len(tables):
                continue  # skip invalid
                
            full_text = outside_text
            for table in tables:
                full_text = full_text.replace('<TABLE></TABLE>', table, 1)

            # Remove all blank lines before saving
            full_text = '\n'.join([line for line in full_text.splitlines() if line.strip() != ''])

            # Save to model-specific file
            with open(txt_path, 'w', encoding='utf-8') as txt_file:
                txt_file.write(full_text)
                
            saved_models.append(model)
            
            # Store content for potential final file save
            final_content = full_text
            final_model = model
        
        # If exactly one model was saved, also save to final file
        if len(saved_models) == 1 and final_content is not None:
            base_name = file_id
            final_path = os.path.join(IMAGES_DIR, f"{base_name}-final.txt")
            with open(final_path, 'w', encoding='utf-8') as final_file:
                final_file.write(final_content)
            print(f"Saved final annotation file: {final_path} (from {final_model})")
        
        force_index_refresh()
        return jsonify({
            "success": True,
            "message": "Annotation text files updated successfully",
            "saved_models": saved_models,
            "final_saved": len(saved_models) == 1
        })
    except Exception as e:
        print(f"Error updating text file: {str(e)}")
        return jsonify({"error": str(e)}), 500

def get_file_timestamp(file_path):
    """Get the last modification time of a file"""
    try:
        return os.path.getmtime(file_path)
    except:
        return 0

def is_file_modified(current_time, last_read_time, tolerance_seconds=1):
    """
    Check if a file has been modified, with a tolerance window to account for
    small timestamp differences
    """
    return current_time - last_read_time > tolerance_seconds

def force_index_refresh():
    """Force a refresh of the file index"""
    global file_index, index_last_updated
    file_index = None
    index_last_updated = 0

@app.route('/api/files/<file_id>/diff', methods=['GET'])
def get_file_diff(file_id):
    """Get both annotation contents and their diff result"""
    try:
        index = build_file_index()
        file_info = next((file for file in index if file["id"] == file_id), None)
        if not file_info:
            return jsonify({"error": "File not found"}), 404
        model_names = MODEL_NAMES
        txt_paths = [file_info["txtPaths"].get(model) for model in model_names]
        if not all(txt_paths) or not all(os.path.exists(p) for p in txt_paths):
            return jsonify({"error": "One or both annotation files not found"}), 404
        # Read and parse both files
        parsed = []
        for path in txt_paths:
            parsed.append(get_parsed_content(path))
        # Compute diff
        diff_result = compare_ocr_results(txt_paths[1], txt_paths[0])
        # Return both contents and diff
        return jsonify({
            "success": True,
            "models": model_names,
            "annotations": {
                model_names[0]: parsed[0],
                model_names[1]: parsed[1]
            },
            "diff": diff_result
        })
    except Exception as e:
        print(f"Error getting file diff: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/diff/compare', methods=['POST'])
def diff_compare():
    """Compute diff between two annotation contents (not files)"""
    try:
        data = request.json
        # Expecting: { "gemini_2.0_flash": {"outside_text": ..., "tables": [...]}, "gemini_2.5_flash": { ... } }
        model_names = MODEL_NAMES
        contents = {}
        for model in model_names:
            model_data = data.get(model)
            if not model_data:
                return jsonify({"error": f"Missing data for model {model}"}), 400
            outside_text = model_data.get("outside_text", "")
            tables = model_data.get("tables", [])
            # Reconstruct full text
            full_text = outside_text
            for table in tables:
                full_text = full_text.replace('<TABLE></TABLE>', table, 1)
            contents[model] = full_text
        # Compute diff
        diff_result = compare_ocr_results_from_content(contents[model_names[1]], contents[model_names[0]])
        return jsonify({
            "success": True,
            "diff": diff_result
        })
    except Exception as e:
        print(f"Error in diff_compare: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Initialize mimetypes
    mimetypes.init()
    
    # Create excluded directory if it doesn't exist
    ensure_excluded_dir()
    
    # Start the server
    print(f"Starting server on port {PORT}")
    print(f"Serving images from {IMAGES_DIR}")
    print(f"Excluded files will be moved to {EXCLUDED_DIR}")
    app.run(host='0.0.0.0', port=PORT, debug=True)